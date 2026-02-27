#!/usr/bin/env node

/**
 * CacheBash MCP Server v2 — Slim entry point.
 * Tool registration, HTTP routing, server startup.
 */

import http from "http";
import * as admin from "firebase-admin";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CustomHTTPTransport } from "./transport/CustomHTTPTransport.js";
import { initializeFirebase, getFirestore } from "./firebase/client.js";
import { validateAuth, type AuthContext } from "./auth/authValidator.js";
import { generateCorrelationId, createAuditLogger } from "./middleware/gate.js";
import { enforceRateLimit, checkAuthRateLimit, cleanupRateLimits, setRateLimitResult, consumeRateLimitResult } from "./middleware/rateLimiter.js";
import { cleanupExpiredRelayMessages } from "./modules/relay.js";
import { cleanupExpiredTasks } from "./modules/dispatch.js";
import { logToolCall } from "./modules/ledger.js";
import { traceToolCall } from "./modules/trace.js";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./tools.js";
import { createIsoServer, setIsoSessionAuth, cleanupIsoSessions } from "./iso/isoServer.js";
import { createRestRouter } from "./transport/rest.js";
import { handleGithubWebhook } from "./modules/github-webhook.js";
import { SessionManager } from "./transport/SessionManager.js";
import { emitEvent } from "./modules/events.js";
import { reconcileGitHub } from "./modules/github-reconcile.js";
import { detectStaleSessions } from "./modules/stale-session-detector.js";
import { checkSessionCompliance, resetTransportCompliance } from "./middleware/sessionCompliance.js";
import { checkPricing } from "./middleware/pricingEnforce.js";
import { incrementUsage } from "./middleware/usage.js";
import { handleOAuthMetadata } from "./oauth/metadata.js";
import { handleOAuthRegister, cleanupDcrRateLimits } from "./oauth/register.js";
import { handleOAuthAuthorize } from "./oauth/authorize.js";
import { handleOAuthConsent } from "./oauth/consent.js";
import { handleOAuthCallback } from "./oauth/callback.js";
import { handleOAuthToken, cleanupCcRateLimits } from "./oauth/token.js";
import { handleOAuthRevoke } from "./oauth/revoke.js";
import { handleServiceAccounts } from "./oauth/serviceAccounts.js";

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

async function getActiveUserIds(): Promise<string[]> {
  try {
    const db = getFirestore();
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
    return Array.from(activeUserIds);
  } catch (err) {
    console.error("[Internal] Failed to resolve active users:", err);
    return [];
  }
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

    console.log(`[TENANT] Tool=${name} userId=${auth.userId} programId=${auth.programId}`);

    // Per-key + per-tenant + per-tool rate limiting (SPEC 2)
    const rateResult = enforceRateLimit(auth.userId, auth.apiKeyHash, name);
    if (sessionId) setRateLimitResult(sessionId, rateResult);
    if (!rateResult.allowed) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "rate_limited",
            retryAfter: rateResult.retryAfter,
            limit: rateResult.limit,
            remaining: 0,
            scope: rateResult.scope,
          }),
        }],
        isError: true,
      };
    }
    // Phase 4: Capability gate
    const { checkToolCapability } = await import("./middleware/capabilities.js");
    const capCheck = checkToolCapability(name, auth.capabilities);
    if (!capCheck.allowed) {
      audit.error(name, `Insufficient capability: requires "${capCheck.required}"`, { tool: name, programId: auth.programId, source: auth.programId, endpoint: "mcp" });
      return { content: [{ type: "text", text: `Insufficient capability: ${name} requires "${capCheck.required}" but key has [${auth.capabilities.join(", ")}]` }], isError: true };
    }

    // OAuth scope enforcement — only applies to OAuth tokens
    if (auth.oauthScopes) {
      const { checkToolScope } = await import("./oauth/scopes.js");
      const scopeError = checkToolScope(name, auth.oauthScopes);
      if (scopeError) {
        audit.error(name, scopeError, { tool: name, programId: auth.programId, source: auth.programId, endpoint: "mcp" });
        return { content: [{ type: "text", text: JSON.stringify({ error: "insufficient_scope", error_description: scopeError }) }], isError: true };
      }
    }

    let complianceWarning: string | undefined;
    try {
      const complianceResult = await checkSessionCompliance(auth, name, (args || {}) as Record<string, unknown>, {
        sessionId,
        endpoint: "mcp",
      });
      if (!complianceResult.allowed) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: complianceResult.reason,
              code: complianceResult.code,
            }),
          }],
          isError: true,
        };
      }
      complianceWarning = complianceResult.warning;
    } catch (err) {
      console.error("[Compliance] Check failed, failing open:", err);
    }

    let pricingWarning: string | undefined;
    try {
      const pricingResult = await checkPricing(auth, name);
      if (!pricingResult.allowed) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: pricingResult.reason,
              code: "PRICING_LIMIT_REACHED",
            }),
          }],
          isError: true,
        };
      }
      pricingWarning = pricingResult.warning;
    } catch (err) {
      console.error("[Pricing] Check failed, failing open:", err);
    }

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const result = await handler(auth, args);
      if ((complianceWarning || pricingWarning) && result?.content?.[0]?.text) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          if (complianceWarning) parsed._compliance = { warning: complianceWarning };
          if (pricingWarning) parsed._pricing = { warning: pricingWarning };
          result.content[0].text = JSON.stringify(parsed);
        } catch {
          // Not JSON payload; skip warning injection.
        }
      }
      // Usage counters (fire-and-forget)
      incrementUsage(auth.userId, "total_tool_calls");
      if (name === "create_task") incrementUsage(auth.userId, "tasks_created");
      if (name === "send_message") incrementUsage(auth.userId, "messages_sent");
      if (name === "create_session") {
        incrementUsage(auth.userId, "sessions_started");
        // Reset compliance for this MCP transport session so a DEREZED
        // session can start fresh without requiring a new MCP connection
        if (sessionId) resetTransportCompliance(auth.userId, sessionId);
      }

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

  // Create admin server
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
          healthCheck: "/v1/internal/health-check",
          staleSessions: "/v1/internal/stale-sessions",
        },
        restFallback: {
          description: "If MCP session dies, use REST endpoints with the same Bearer auth",
          baseUrl: `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host || "api.cachebash.dev"}`,
          docs: "See README for full REST API reference",
        },
      });
    }

    // GitHub webhook (no API key auth — uses HMAC signature verification)
    if (url === "/v1/webhooks/github" && req.method === "POST") {
      return handleGithubWebhook(req, res);
    }

    // OAuth endpoints (public — no Bearer auth required)
    if (url === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      return handleOAuthMetadata(req, res);
    }
    if (url === "/register" && req.method === "POST") {
      // Pass optional Bearer auth for service account registration
      const regToken = extractBearerToken(req.headers.authorization);
      let regUserId: string | undefined;
      if (regToken) {
        const regAuth = await validateAuth(regToken);
        if (regAuth) regUserId = regAuth.userId;
      }
      return handleOAuthRegister(req, res, regUserId);
    }
    if (url === "/authorize" && req.method === "GET") {
      return handleOAuthAuthorize(req, res);
    }
    if (url?.startsWith("/oauth/consent")) {
      return handleOAuthConsent(req, res);
    }
    if (url === "/authorize/callback" && req.method === "GET") {
      return handleOAuthCallback(req, res);
    }
    if (url === "/token" && req.method === "POST") {
      return handleOAuthToken(req, res);
    }
    if (url === "/revoke" && req.method === "POST") {
      return handleOAuthRevoke(req, res);
    }

    // Service account management (requires Bearer auth)
    if (url?.startsWith("/oauth/service-accounts")) {
      const saToken = extractBearerToken(req.headers.authorization);
      if (!saToken) return sendJson(res, 401, { error: "unauthorized", error_description: "Bearer token required" });
      const saAuth = await validateAuth(saToken);
      if (!saAuth) return sendJson(res, 401, { error: "unauthorized", error_description: "Invalid token" });
      return handleServiceAccounts(req, res, saAuth);
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
    // REST API — but NOT internal endpoints (those are handled below without auth)
    if (url?.startsWith("/v1/") && url !== "/v1/mcp" && url !== "/v1/iso/mcp" && !url?.startsWith("/v1/internal/")) {
      return restRouter(req, res);
    }

    // Internal cleanup endpoint (scheduled job)
    if (url === "/v1/internal/cleanup" && req.method === "POST") {
      // TODO: Restrict to Cloud Scheduler service account in production
      const startTime = Date.now();

      try {
        const activeUserIds = await getActiveUserIds();

        let totalRelayExpired = 0;
        let totalRelayCleaned = 0;
        let totalSessionsExpired = 0;
        let totalSessionsCleaned = 0;
        let totalTasksExpired = 0;
        let totalTasksCleaned = 0;

        // Run cleanup for each active user
        for (const userId of activeUserIds) {
          const relayResult = await cleanupExpiredRelayMessages(userId);
          totalRelayExpired += relayResult.expired;
          totalRelayCleaned += relayResult.cleaned;

          const sessionResult = await sessionManager.cleanupExpiredSessions(userId);
          totalSessionsExpired += sessionResult.expired;
          totalSessionsCleaned += sessionResult.cleaned;

          const taskResult = await cleanupExpiredTasks(userId);
          totalTasksExpired += taskResult.expired;
          totalTasksCleaned += taskResult.cleaned;
        }

        const duration = Date.now() - startTime;

        // Emit CLEANUP_RUN event for each active user
        for (const userId of activeUserIds) {
          emitEvent(userId, {
            event_type: "CLEANUP_RUN",
            relay_expired: totalRelayExpired,
            sessions_expired: totalSessionsExpired,
            tasks_expired: totalTasksExpired,
            duration_ms: duration,
          });
        }

        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.length,
          relay: {
            expired: totalRelayExpired,
            cleaned: totalRelayCleaned,
          },
          sessions: {
            expired: totalSessionsExpired,
            cleaned: totalSessionsCleaned,
          },
          tasks: {
            expired: totalTasksExpired,
            cleaned: totalTasksCleaned,
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
        const activeUserIds = await getActiveUserIds();

        const { pollAndWake } = await import("./lifecycle/wake-daemon.js");
        const results = [];

        for (const userId of activeUserIds) {
          const result = await pollAndWake(userId);
          results.push({ userId: userId.substring(0, 8) + "...", ...result });
        }

        const duration = Date.now() - startTime;
        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.length,
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

    // GitHub reconciliation endpoint (scheduled job)
    if (url === "/v1/internal/reconcile-github" && req.method === "POST") {
      const startTime = Date.now();

      try {
        const activeUserIds = await getActiveUserIds();

        const results: any[] = [];
        for (const userId of activeUserIds) {
          const result = await reconcileGitHub(userId);
          if (result.processed > 0) {
            results.push({ userId: userId.substring(0, 8) + "...", ...result });
          }
        }

        // Emit event
        for (const userId of activeUserIds) {
          emitEvent(userId, {
            event_type: "CLEANUP_RUN",
            program_id: "gridbot",
            session_id: "scheduler",
            reconciliation: true,
          });
        }

        const duration = Date.now() - startTime;
        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.length,
          results,
          duration_ms: duration,
        });
      } catch (error) {
        console.error("[GitHubReconcile] Reconciliation failed:", error);
        return sendJson(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Admin MCP endpoint (Bearer auth)
    if (url === "/v1/iso/mcp") {
      const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        checkAuthRateLimit(clientIp);
        return sendJson(res, 401, { error: "Missing Authorization header" });
      }
      const auth = await validateAuth(token);
      if (!auth) {
        if (!checkAuthRateLimit(clientIp)) {
          return sendJson(res, 429, { error: "Too many authentication attempts. Try again later." });
        }
        return sendJson(res, 401, { error: "Invalid API key" });
      }

      const isoMcpSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (isoMcpSessionId) setIsoSessionAuth(isoMcpSessionId, auth);

      const webReq = await nodeToWebRequest(req);
      const webRes = await iso.transport.handleRequest(webReq, auth);

      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      const body = await webRes.text();
      return res.end(body);
    }

    // Health check endpoint (scheduled job)
    if (url === "/v1/internal/health-check" && req.method === "POST") {
      const startTime = Date.now();

      try {
        const { runHealthCheck } = await import("./modules/gridbot-monitor.js");
        const activeUserIds = await getActiveUserIds();

        const results = [];
        for (const userId of activeUserIds) {
          const result = await runHealthCheck(userId);
          results.push({ userId: userId.substring(0, 8) + "...", ...result });
        }

        const duration = Date.now() - startTime;
        return sendJson(res, 200, {
          success: true,
          activeUsers: activeUserIds.length,
          results,
          duration_ms: duration,
        });
      } catch (error) {
        console.error("[HealthCheck] Health check failed:", error);
        return sendJson(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Stale session detection endpoint (scheduled job)
    if (url === "/v1/internal/stale-sessions" && req.method === "POST") {
      try {
        const db = getFirestore();
        const activeUserIds = await getActiveUserIds();
        const results: Record<string, any> = {};
        let totalStale = 0;
        let totalArchived = 0;

        for (const userId of activeUserIds) {
          const result = await detectStaleSessions(userId);
          if (result.stale.length === 0) continue;

          results[userId] = result;
          totalStale += result.stale.length;
          totalArchived += result.archived;

          for (const session of result.stale) {
            const alertType = session.action === "archived" ? "error" : "warning";
            const message = session.action === "archived"
              ? `${session.programId} session archived (no heartbeat for ${session.ageMinutes}min)`
              : `${session.programId} may be hanging (no heartbeat for ${session.ageMinutes}min)`;

            const alertDoc = {
              source: "system",
              target: "admin",
              message_type: "STATUS",
              message,
              alertType,
              priority: session.action === "archived" ? "high" : "normal",
              status: "pending",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 3600000)),
            };

            try {
              await db.collection(`tenants/${userId}/relay`).add(alertDoc);
              await db.collection(`tenants/${userId}/tasks`).add({
                ...alertDoc,
                type: "task",
                title: `[Alert: ${alertType}] ${session.programId} stale`,
              });
            } catch (err) {
              console.error(`[Stale Sessions] Failed alert write for ${userId}/${session.sessionId}:`, err);
            }
          }
        }

        return sendJson(res, 200, {
          success: true,
          totalStale,
          totalArchived,
          activeUsers: activeUserIds.length,
          results,
        });
      } catch (error) {
        console.error("[Stale Sessions] Detection failed:", error);
        return sendJson(res, 500, { error: "Stale session detection failed" });
      }
    }

    // Main MCP endpoint
    if (url === "/v1/mcp" || url === "/mcp") {
      const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost";
      const wwwAuth = `Bearer resource_metadata="${proto}://${host}/.well-known/oauth-authorization-server"`;

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        checkAuthRateLimit(clientIp);
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": wwwAuth });
        res.end(JSON.stringify({ error: "unauthorized", error_description: "Bearer token required" }));
        return;
      }
      const auth = await validateAuth(token);
      if (!auth) {
        if (!checkAuthRateLimit(clientIp)) {
          return sendJson(res, 429, { error: "Too many authentication attempts. Try again later." });
        }
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": wwwAuth });
        res.end(JSON.stringify({ error: "unauthorized", error_description: "Invalid or expired token" }));
        return;
      }

      const mcpSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (mcpSessionId) {
        sessions.set(mcpSessionId, { authContext: auth, lastActivity: Date.now() });
      }

      const webReq = await nodeToWebRequest(req);
      const webRes = await transport.handleRequest(webReq, auth);

      // Inject rate limit headers (SPEC 2)
      const headers = Object.fromEntries(webRes.headers.entries());
      if (mcpSessionId) {
        const rl = consumeRateLimitResult(mcpSessionId);
        if (rl) {
          headers["X-RateLimit-Limit"] = String(rl.limit);
          headers["X-RateLimit-Remaining"] = String(rl.remaining);
          headers["X-RateLimit-Reset"] = String(Math.ceil(rl.resetAt.getTime() / 1000));
        }
      }

      res.writeHead(webRes.status, headers);
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
    cleanupDcrRateLimits();
    cleanupCcRateLimits();
    // TTL cleanup for expired relay messages — run per distinct tenant
    const cleanedUserIds = new Set<string>();
    for (const [, info] of sessions.entries()) {
      const uid = info.authContext.userId;
      if (cleanedUserIds.has(uid)) continue;
      cleanedUserIds.add(uid);
      cleanupExpiredRelayMessages(uid).catch((err) => {
        console.error("[Relay] TTL cleanup failed for", uid, err);
      });
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
