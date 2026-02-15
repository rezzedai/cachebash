#!/usr/bin/env node

/**
 * CacheBash MCP Server v2 — Slim entry point.
 * Tool registration, HTTP routing, server startup.
 */

import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CustomHTTPTransport } from "./transport/CustomHTTPTransport.js";
import { initializeFirebase } from "./firebase/client.js";
import { validateApiKey, type AuthContext } from "./auth/apiKeyValidator.js";
import { generateCorrelationId, createAuditLogger } from "./middleware/gate.js";
import { checkRateLimit, getRateLimitResetIn, cleanupRateLimits } from "./middleware/rateLimiter.js";
import { checkDreamBudget } from "./middleware/budgetGuard.js";
import { logToolCall } from "./modules/ledger.js";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./tools.js";
import { createIsoServer, setIsoSessionAuth, cleanupIsoSessions } from "./iso/isoServer.js";
import { createRestRouter } from "./transport/rest.js";

const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const PORT = parseInt(process.env.PORT || "3001", 10);

// Per-session auth context
const sessions = new Map<string, { authContext: AuthContext; lastActivity: number }>();

function extractBearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function nodeToWebRequest(req: http.IncomingMessage): Promise<Request> {
  const protocol = (req.socket as any).encrypted ? "https" : "http";
  const host = req.headers.host || "localhost";
  const url = `${protocol}://${host}${req.url}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = chunks.length > 0 ? Buffer.concat(chunks) : null;
  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

async function main() {
  initializeFirebase();

  // Create MCP server
  const server = new Server(
    { name: "cachebash-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const sessionId = extra?.sessionId;
    const auth = sessionId ? sessions.get(sessionId)?.authContext : null;
    const correlationId = generateCorrelationId();
    const startTime = Date.now();

    if (!auth) {
      return { content: [{ type: "text", text: "Error: Not authenticated." }], isError: true };
    }

    if (!checkRateLimit(auth.userId, name)) {
      return { content: [{ type: "text", text: `Rate limit exceeded for ${name}.` }], isError: true };
    }

    // Budget enforcement — reject if dream budget exceeded
    const budgetCheck = await checkDreamBudget(auth);
    if (!budgetCheck.allowed) {
      logToolCall(auth.userId, name, auth.programId, "mcp", sessionId, Date.now() - startTime, false, budgetCheck.reason);
      return { content: [{ type: "text", text: `Budget exceeded: ${budgetCheck.reason}` }], isError: true };
    }

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const result = await handler(auth, args);
      logToolCall(auth.userId, name, auth.programId, "mcp", sessionId, Date.now() - startTime, true, undefined, budgetCheck.dreamId);
      return result;
    } catch (err) {
      logToolCall(auth.userId, name, auth.programId, "mcp", sessionId, Date.now() - startTime, false,
        err instanceof Error ? err.message : String(err), budgetCheck.dreamId);
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  const transport = new CustomHTTPTransport({
    sessionTimeout: SESSION_TIMEOUT_MS,
    enableDnsRebindingProtection: false,
    strictAcceptHeader: false,
    responseQueueTimeout: 2000,
  });

  await server.connect(transport);

  // Create ISO server
  const iso = await createIsoServer();

  // Create REST router
  const restRouter = createRestRouter();

  // HTTP server
  const httpServer = http.createServer(async (req, res) => {
    const url = req.url?.split("?")[0];

    // Health check
    if (url === "/v1/health" && req.method === "GET") {
      return sendJson(res, 200, { status: "ok", version: "2.0.0", timestamp: new Date().toISOString() });
    }

    // REST API
    if (url?.startsWith("/v1/") && url !== "/v1/mcp" && url !== "/v1/iso/mcp") {
      return restRouter(req, res);
    }

    // ISO MCP endpoint (Bearer auth)
    if (url === "/v1/iso/mcp") {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) return sendJson(res, 401, { error: "Missing Authorization header" });
      const auth = await validateApiKey(token);
      if (!auth) return sendJson(res, 401, { error: "Invalid API key" });

      const webReq = await nodeToWebRequest(req);
      const webRes = await iso.transport.handleRequest(webReq, auth);

      const sessionId = webRes.headers.get("Mcp-Session-Id");
      if (sessionId) setIsoSessionAuth(sessionId, auth);

      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      const body = await webRes.text();
      return res.end(body);
    }

    // Main MCP endpoint
    if (url === "/v1/mcp" || url === "/mcp") {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) return sendJson(res, 401, { error: "Missing Authorization header" });
      const auth = await validateApiKey(token);
      if (!auth) return sendJson(res, 401, { error: "Invalid API key" });

      const webReq = await nodeToWebRequest(req);
      const webRes = await transport.handleRequest(webReq, auth);

      const sessionId = webRes.headers.get("Mcp-Session-Id");
      if (sessionId) sessions.set(sessionId, { authContext: auth, lastActivity: Date.now() });

      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      const body = await webRes.text();
      return res.end(body);
    }

    sendJson(res, 404, { error: "Not found" });
  });

  // Cleanup intervals
  setInterval(() => {
    const now = Date.now();
    for (const [id, info] of sessions.entries()) {
      if (now - info.lastActivity > SESSION_TIMEOUT_MS) sessions.delete(id);
    }
    cleanupIsoSessions(SESSION_TIMEOUT_MS);
    cleanupRateLimits();
  }, 5 * 60 * 1000);

  httpServer.listen(PORT, () => {
    console.log(`[CacheBash] MCP Server v2 listening on port ${PORT}`);
    console.log(`[CacheBash] Endpoints: /v1/mcp, /v1/iso/mcp, /v1/* (REST)`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("[CacheBash] Shutting down...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[CacheBash] Fatal error:", err);
  process.exit(1);
});
