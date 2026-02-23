#!/usr/bin/env node

/**
 * CacheBash MCP Server v2 — Slim entry point.
 * Tool registration, HTTP routing, server startup.
 */

import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CustomHTTPTransport } from "./transport/CustomHTTPTransport.js";
import { initializeFirebase, getFirestore } from "./firebase/client.js";
import { validateAuth, type AuthContext } from "./auth/apiKeyValidator.js";
import { generateCorrelationId, createAuditLogger } from "./middleware/gate.js";
import { checkRateLimit, getRateLimitResetIn, checkAuthRateLimit, cleanupRateLimits } from "./middleware/rateLimiter.js";
import { cleanupExpiredRelayMessages } from "./modules/relay.js";
import { logToolCall } from "./modules/ledger.js";
import { traceToolCall } from "./modules/trace.js";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./tools.js";
import { createIsoServer, setIsoSessionAuth, cleanupIsoSessions } from "./iso/isoServer.js";
import { createRestRouter } from "./transport/rest.js";
import { handleGithubWebhook } from "./modules/github-webhook.js";
import { SessionManager } from "./transport/SessionManager.js";
import { emitEvent } from "./modules/events.js";

const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const PORT = parseInt(process.env.PORT || "3001", 10);

// Per-session auth context
const sessions = new Map<string, { authContext: AuthContext; lastActivity: number }>();

// Session manager for cleanup
const sessionManager = new SessionManager(SESSION_TIMEOUT_MS);

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
    const audit = createAuditLogger(correlationId, auth?.userId || "unknown");
    const startTime = Date.now();

    if (!auth) {
      return { content: [{ type: "text", text: "Error: Not authenticated." }], isError: true };
    }

    if (!checkRateLimit(auth.userId, name)) {
      const resetIn = getRateLimitResetIn(auth.userId, name);
      return { content: [{ type: "text", text: `Rate limit exceeded for ${name}. Try again in ${resetIn}s.` }], isError: true };
    }

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const result = await handler(auth, args);
      logToolCall(auth.userId, name, auth.programId, "mcp", sessionId, Date.now() - startTime, true);
      traceToolCall(auth.userId, name, auth.programId, "mcp", sessionId, args,
        JSON.stringify(result).substring(0, 500), Date.now() - startTime, true);
      audit.log(name, { tool: name, programId: auth.programId, source: auth.programId, endpoint: "mcp" });
      return result;
    } catch (err) {
      logToolCall(auth.userId, name, auth.programId, "mcp", sessionId, Date.now() - startTime, false,
        err instanceof Error ? err.message : String(err));
      traceToolCall(auth.userId, name, auth.programId, "mcp", sessionId, args,
        "", Date.now() - startTime, false, err instanceof Error ? err.message : String(err));
      audit.error(name, err instanceof Error ? err.message : String(err), { tool: name, programId: auth.programId, source: auth.programId, endpoint: "mcp" });
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
      return sendJson(res, 200, {
        status: "ok",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
        endpoints: {
          mcp: "/v1/mcp",
          rest: "/v1/{resource}",
          health: "/v1/health",
          cleanup: "/v1/internal/cleanup",
          wake: "/v1/internal/wake",
        },
        restFallback: {
          description: "If MCP session dies, use REST endpoints with the same Bearer auth",
          baseUrl: `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host || "cachebash-mcp-922749444863.us-central1.run.app"}`,
          docs: "See README for full REST API reference",
        },
      });
    }

    // GitHub webhook (no API key auth — uses HMAC signature verification)
    if (url === "/v1/webhooks/github" && req.method === "POST") {
      return handleGithubWebhook(req, res);
    }

    // REST API

    // MCP heartbeat endpoint (out-of-band session keepalive)
    if (url === "/v1/mcp/heartbeat" && req.method === "POST") {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) return sendJson(res, 401, { error: "Missing Authorization header" });
      const auth = await validateAuth(token);
      if (!auth) return sendJson(res, 401, { error: "Invalid API key" });

      const mcpSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!mcpSessionId) return sendJson(res, 400, { error: "Mcp-Session-Id header is required" });

      const validation = await sessionManager.validateSession(mcpSessionId, auth.userId);
      if (!validation.valid) {
        emitEvent(auth.userId, {
          event_type: "SESSION_DEATH",
          session_id: mcpSessionId,
          program_id: auth.programId || "unknown",
        });
        return sendJson(res, 410, {
          error: "Session expired or invalid",
          detail: validation.error,
          fallback: "Use REST API: POST /v1/{tool_name} with Bearer auth",
        });
      }

      // Also refresh the in-memory session map
      if (sessions.has(mcpSessionId)) {
        sessions.get(mcpSessionId)!.lastActivity = Date.now();
      }

      const remainingMs = SESSION_TIMEOUT_MS - (Date.now() - (validation.session!.lastActivity || Date.now()));
      return sendJson(res, 200, {
        status: "alive",
        session_id: mcpSessionId,
        session_expires_in_ms: Math.max(0, remainingMs),
      });
    }
    if (url?.startsWith("/v1/") && url !== "/v1/mcp" && url !== "/v1/iso/mcp") {
      return restRouter(req, res);
    }

    // Internal cleanup endpoint (scheduled job)
    if (url === "/v1/internal/cleanup" && req.method === "POST") {
      // TODO: Restrict to Cloud Scheduler service account in production
      const startTime = Date.now();

      try {
        const db = getFirestore();

        // Find active users (API keys used in last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const keysSnapshot = await db
          .collection("apiKeys")
          .where("lastUsedAt", ">=", sevenDaysAgo)
          .get();

        const activeUserIds = new Set<string>();
        for (const doc of keysSnapshot.docs) {
          const userId = doc.data().userId;
          if (userId) activeUserIds.add(userId);
        }

        let totalRelayExpired = 0;
        let totalRelayCleaned = 0;
        let totalSessionsExpired = 0;
        let totalSessionsCleaned = 0;

        // Run cleanup for each active user
        for (const userId of activeUserIds) {
          const relayResult = await cleanupExpiredRelayMessages(userId);
          totalRelayExpired += relayResult.expired;
          totalRelayCleaned += relayResult.cleaned;

          const sessionResult = await sessionManager.cleanupExpiredSessions(userId);
          totalSessionsExpired += sessionResult.expired;
          totalSessionsCleaned += sessionResult.cleaned;
        }

        const duration = Date.now() - startTime;

        // Emit CLEANUP_RUN event for each active user
        for (const userId of activeUserIds) {
          emitEvent(userId, {
            event_type: "CLEANUP_RUN",
            relay_expired: totalRelayExpired,
            sessions_expired: totalSessionsExpired,
            duration_ms: duration,
          });
        }

        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.size,
          relay: {
            expired: totalRelayExpired,
            cleaned: totalRelayCleaned,
          },
          sessions: {
            expired: totalSessionsExpired,
            cleaned: totalSessionsCleaned,
          },
          duration_ms: duration,
        });
      } catch (error) {
        console.error("[Cleanup] Internal cleanup failed:", error);
        return sendJson(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Wake daemon endpoint (scheduled job)
    if (url === "/v1/internal/wake" && req.method === "POST") {
      const startTime = Date.now();

      try {
        const db = getFirestore();

        // Find active user (same pattern as cleanup)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const keysSnapshot = await db
          .collection("apiKeys")
          .where("lastUsedAt", ">=", sevenDaysAgo)
          .get();

        const activeUserIds = new Set<string>();
        for (const doc of keysSnapshot.docs) {
          const userId = doc.data().userId;
          if (userId) activeUserIds.add(userId);
        }

        const { pollAndWake } = await import("./lifecycle/wake-daemon.js");
        const results = [];

        for (const userId of activeUserIds) {
          const result = await pollAndWake(userId);
          results.push({ userId: userId.substring(0, 8) + "...", ...result });
        }

        const duration = Date.now() - startTime;
        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.size,
          results,
          duration_ms: duration,
        });
      } catch (error) {
        console.error("[WakeDaemon] Wake poll failed:", error);
        return sendJson(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ISO MCP endpoint (Bearer auth)
    if (url === "/v1/iso/mcp") {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) return sendJson(res, 401, { error: "Missing Authorization header" });
      const auth = await validateAuth(token);
      if (!auth) return sendJson(res, 401, { error: "Invalid API key" });

      const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      if (!checkAuthRateLimit(clientIp)) {
        return sendJson(res, 429, { error: "Too many authentication attempts. Try again later." });
      }

      const isoMcpSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (isoMcpSessionId) setIsoSessionAuth(isoMcpSessionId, auth);

      const webReq = await nodeToWebRequest(req);
      const webRes = await iso.transport.handleRequest(webReq, auth);

      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      const body = await webRes.text();
      return res.end(body);
    }

    // Main MCP endpoint
    if (url === "/v1/mcp" || url === "/mcp") {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) return sendJson(res, 401, { error: "Missing Authorization header" });
      const auth = await validateAuth(token);
      if (!auth) return sendJson(res, 401, { error: "Invalid API key" });

      const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      if (!checkAuthRateLimit(clientIp)) {
        return sendJson(res, 429, { error: "Too many authentication attempts. Try again later." });
      }

      const mcpSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (mcpSessionId) {
        sessions.set(mcpSessionId, { authContext: auth, lastActivity: Date.now() });
      }

      const webReq = await nodeToWebRequest(req);
      const webRes = await transport.handleRequest(webReq, auth);

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
    // TTL cleanup for expired relay messages (uses admin UID from first active session)
    for (const [, info] of sessions.entries()) {
      cleanupExpiredRelayMessages(info.authContext.userId).catch((err) => {
        console.error("[Relay] TTL cleanup failed:", err);
      });
      break; // Only need one userId — all sessions share the same admin user
    }
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
