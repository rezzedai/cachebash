/**
 * REST Transport — Full MCP-REST parity.
 * Every MCP tool has a corresponding REST endpoint.
 */

import http from "http";
import { ZodError } from "zod";
import { validateAuth, TenantResolutionError, type AuthContext } from "../auth/authValidator.js";
import { TOOL_HANDLERS } from "../tools.js";
import { logToolCall } from "../modules/ledger.js";
import { traceToolCall } from "../modules/trace.js";
import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { generateCorrelationId, createAuditLogger } from "../middleware/gate.js";
import { gspListNamespacesHandler } from "../modules/gsp.js";
import { enforceRateLimit, checkAuthRateLimit } from "../middleware/rateLimiter.js";
import { checkSessionCompliance, resetTransportCompliance } from "../middleware/sessionCompliance.js";
import { checkPricing } from "../middleware/pricingEnforce.js";
import { CapabilityError } from "../middleware/capabilities.js";
import { checkCircuitBreaker, type BreakerCode } from "../middleware/circuitBreaker.js";
import { incrementUsage, incrementSeatUsage } from "../middleware/usage.js";
import { CONSTANTS } from "../config/constants.js";
import { resolveToolAlias } from "../tools/tool-aliases.js";
import { generateOpenApiSpec } from "../modules/openapi.js";
import { enrollHandler } from "../modules/enrollment.js";
import { credentialPrincipal, hasFleetObserveCapability } from "../auth/ownerAuthz.js";
import { FieldValue, Timestamp, Query } from "firebase-admin/firestore";

import { logDenial, denialPrincipal } from "../auth/denialLog.js";
export class ValidationError extends Error {
  issues: Array<{ path: string; message: string; code: string }>;
  constructor(message: string, issues: Array<{ path: string; message: string; code: string }>) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

class ComplianceError extends Error {
  code: "SESSION_TERMINATED" | "COMPLIANCE_BLOCKED";
  constructor(message: string, code: "SESSION_TERMINATED" | "COMPLIANCE_BLOCKED") {
    super(message);
    this.name = "ComplianceError";
    this.code = code;
  }
}

class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

class BreakerError extends Error {
  code: BreakerCode;
  retryAfterMs: number;
  constructor(message: string, code: BreakerCode, retryAfterMs: number) {
    super(message);
    this.name = "BreakerError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractBearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

const MAX_BODY_SIZE = CONSTANTS.limits.maxBodySizeBytes;
async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new ValidationError('Request body too large (max 64KB)', [
        { path: 'body', message: 'Exceeds maximum size of 64KB', code: 'too_big' }
      ]);
    }
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ValidationError('Invalid JSON in request body', [
      { path: 'body', message: 'Request body is not valid JSON', code: 'invalid_type' }
    ]);
  }
}

function parseQuery(url: string): Record<string, string> {
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return {};
  const params: Record<string, string> = {};
  const qs = url.slice(qIdx + 1);
  for (const pair of qs.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return params;
}

/** Numeric and boolean fields that arrive as strings from query params */
const NUMERIC_FIELDS = new Set(['limit', 'progress', 'ttl', 'budget_cap_usd', 'timeout_hours', 'wave', 'maxConcurrent', 'completed', 'failed', 'skipped', 'duration', 'cost_tokens', 'confidence']);
const BOOLEAN_FIELDS = new Set(['markAsRead', 'includeDelivered', 'includeArchived', 'includeRevoked', 'allowed', 'encrypt', 'lastHeartbeat']);

/** Coerce string query params to proper types before Zod validation */
function coerceQueryParams(params: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      result[key] = Number.isNaN(n) ? value : n;
    } else if (BOOLEAN_FIELDS.has(key)) {
      result[key] = value === 'true' || value === '1';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Compute period start date for time-range filters */
function periodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "this_week": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case "this_month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return new Date(0);
  }
}

function restResponse(res: http.ServerResponse, success: boolean, data: unknown, status = 200): void {
  sendJson(res, status, {
    success,
    data: success ? data : undefined,
    error: success ? undefined : data,
    meta: { timestamp: new Date().toISOString() },
  });
}

type RouteHandler = (auth: AuthContext, req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  paramNames: string[];
}

function route(method: string, path: string, handler: RouteHandler): Route {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    }) + "$"
  );
  return { method, pattern, handler, paramNames };
}

async function callTool(auth: AuthContext, req: http.IncomingMessage, toolName: string, args: unknown): Promise<unknown> {
  // Per-key + per-tenant + per-tool rate limiting (tier-aware sliding window)
  const rateResult = enforceRateLimit(auth.userId, auth.apiKeyHash, toolName, auth.rateLimitTier, credentialPrincipal(auth));
  if (!rateResult.allowed) {
    const err = new Error(`Rate limit exceeded. Retry after ${rateResult.retryAfter} seconds.`);
    (err as any).rateLimitResult = rateResult;
    throw err;
  }

  // Phase 4: Capability gate
  const { checkToolCapability } = await import("../middleware/capabilities.js");
  const capCheck = checkToolCapability(toolName, auth.capabilities);
  if (!capCheck.allowed) {
    logDenial({ principal: denialPrincipal(auth), tool: toolName, subject: null, code: "MISSING_CAPABILITY" });
    throw new CapabilityError(toolName, capCheck.required, capCheck.held);
  }

  // WS-3: Boundary circuit breaker — server-measured mutation ceilings, fail-closed.
  // No-op (and no Firestore read) for read-only tools; only mutating calls pay this cost.
  const breakerResult = await checkCircuitBreaker(auth, toolName);
  if (!breakerResult.allowed) {
    createAuditLogger(generateCorrelationId(), auth.userId).error(
      toolName, `${breakerResult.code}: ${breakerResult.message}`,
      { tool: toolName, programId: auth.keyProgramId, source: auth.keyProgramId, endpoint: "rest" }
    );
    throw new BreakerError(breakerResult.message, breakerResult.code, breakerResult.retryAfterMs);
  }

  let complianceWarning: string | undefined;
  const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
  const complianceResult = await checkSessionCompliance(auth, toolName, (args || {}) as Record<string, unknown>, {
    sessionId: mcpSessionId,
    endpoint: "rest",
  });
  if (!complianceResult.allowed) {
    throw new ComplianceError(complianceResult.reason, complianceResult.code);
  }
  complianceWarning = complianceResult.warning;

  let pricingWarning: string | undefined;
  try {
    const pricingResult = await checkPricing(auth, toolName);
    if (!pricingResult.allowed) {
      throw new PricingError(pricingResult.reason);
    }
    pricingWarning = pricingResult.warning;
  } catch (err) {
    if (err instanceof PricingError) throw err;
    console.error("[Pricing] Check failed, failing open:", err);
  }

  const canonicalName = resolveToolAlias(toolName);
  const handler = TOOL_HANDLERS[canonicalName];
  if (!handler) throw new Error(`Unknown tool: ${toolName}`);
  const start = Date.now();
  const correlationId = generateCorrelationId();
  const audit = createAuditLogger(correlationId, auth.userId);
  try {
    const result = await handler(auth, args);
    logToolCall(auth.userId, toolName, credentialPrincipal(auth), "rest", undefined, Date.now() - start, true);
    traceToolCall(auth.userId, toolName, credentialPrincipal(auth), "rest", undefined, args,
      JSON.stringify(result).substring(0, 500), Date.now() - start, true);
    audit.log(toolName, { tool: toolName, programId: auth.keyProgramId, source: auth.keyProgramId, endpoint: "rest" });
    // Extract JSON from MCP tool result format
    const text = result?.content?.[0]?.text;
    if (!text) return result;
    const parsed = JSON.parse(text);
    if (complianceWarning && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      (parsed as Record<string, unknown>)._compliance = { warning: complianceWarning };
    }
    if (pricingWarning && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      (parsed as Record<string, unknown>)._pricing = { warning: pricingWarning };
    }
    // Usage counters (fire-and-forget)
    incrementUsage(auth.userId, "total_tool_calls");
    if (auth.seatId) incrementSeatUsage(auth.userId, auth.seatId, "total_tool_calls");
    if (toolName === "create_task") incrementUsage(auth.userId, "tasks_created");
    if (toolName === "send_message") incrementUsage(auth.userId, "messages_sent");
    if (toolName === "create_session") incrementUsage(auth.userId, "sessions_started");

    return parsed;
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      throw new ValidationError(
        `Validation failed: ${issues.map(i => `${i.path}: ${i.message}`).join('; ')}`,
        issues
      );
    }
    logToolCall(auth.userId, toolName, credentialPrincipal(auth), "rest", undefined, Date.now() - start, false,
      err instanceof Error ? err.message : String(err));
    traceToolCall(auth.userId, toolName, credentialPrincipal(auth), "rest", undefined, args,
      "", Date.now() - start, false, err instanceof Error ? err.message : String(err));
    audit.error(toolName, err instanceof Error ? err.message : String(err), { tool: toolName, programId: auth.keyProgramId, source: auth.keyProgramId, endpoint: "rest" });
    throw err;
  }
}

/**
 * Capability + circuit-breaker gate for REST routes whose write logic runs
 * outside callTool() — either because there's no corresponding MCP tool
 * handler (mark_read) or because the route needs custom pre/post handling
 * around the handler call. Throws the same typed errors callTool() throws
 * (a plain capability Error, or BreakerError) so the top-level dispatcher's
 * existing instanceof handling produces the same 403/429/503 responses.
 * Does NOT rate-limit or run compliance/pricing — callers that need those
 * should route through callTool() instead (the preferred path).
 */
async function enforceBreaker(auth: AuthContext, toolName: string): Promise<void> {
  const { checkToolCapability } = await import("../middleware/capabilities.js");
  const capCheck = checkToolCapability(toolName, auth.capabilities);
  if (!capCheck.allowed) {
    logDenial({ principal: denialPrincipal(auth), tool: toolName, subject: null, code: "MISSING_CAPABILITY" });
    throw new CapabilityError(toolName, capCheck.required, capCheck.held);
  }

  const breakerResult = await checkCircuitBreaker(auth, toolName);
  if (!breakerResult.allowed) {
    createAuditLogger(generateCorrelationId(), auth.userId).error(
      toolName, `${breakerResult.code}: ${breakerResult.message}`,
      { tool: toolName, programId: auth.keyProgramId, source: auth.keyProgramId, endpoint: "rest" }
    );
    throw new BreakerError(breakerResult.message, breakerResult.code, breakerResult.retryAfterMs);
  }
}

const routes: Route[] = [
  // Dispatch
  route("GET", "/v1/tasks/stats", async (auth, req, res) => {
    // RD-5 PR-M row 3 (GATE get_tasks): the capability gate, then the get_tasks rule on credentialPrincipal(auth). A named target needs
    // authorizeTasksRead; no target counts the principal's own queue unless it is a TASKS_ALL principal or holds fleet.observe (L-D1).
    await enforceBreaker(auth, "get_tasks");
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const principal = credentialPrincipal(auth);
    const queryTarget = query.target as string | undefined || undefined;
    const { authorizeTasksRead } = await import("../modules/dispatch/tasks.js"); // lazy, as markReadHandler: the module graph pulls the ESM-only octokit
    const { allowed, seesAll } = authorizeTasksRead(auth, queryTarget);
    if (!allowed) {
      logDenial({ principal: denialPrincipal(auth), tool: "dispatch_get_tasks", subject: queryTarget ?? null, code: "FOREIGN_SUBJECT" });
      return restResponse(res, false, { code: "FORBIDDEN", message: `Access denied: "${principal}" cannot read tasks for "${queryTarget}"` }, 403);
    }
    const target = queryTarget ?? (seesAll || hasFleetObserveCapability(auth) ? undefined : principal);
    const db = getFirestore();
    const tasksRef = db.collection(`tenants/${auth.userId}/tasks`);
    const period = query.period as string | undefined;

    if (target || (period && period !== "all")) {
      // Filtered: fetch docs and count in memory to avoid composite index issues
      let q: Query = tasksRef;
      if (target) q = q.where("target", "==", target);
      if (period && period !== "all") {
        q = q.where("createdAt", ">=", Timestamp.fromDate(periodStart(period)));
      }
      q = q.orderBy("createdAt", "desc").limit(5000);
      const snap = await q.get();
      const counts = { created: 0, active: 0, done: 0, failed: 0 };
      for (const doc of snap.docs) {
        const lc = doc.data().lifecycle as string;
        if (lc === "created") counts.created++;
        else if (lc === "active") counts.active++;
        else if (lc === "done") counts.done++;
        else if (lc === "failed") counts.failed++;
      }
      restResponse(res, true, {
        ...counts,
        total: counts.created + counts.active + counts.done + counts.failed,
        ...(queryTarget ? { target: queryTarget } : {}),
        ...(period ? { period } : {}),
      });
    } else {
      // Unfiltered: use efficient count queries
      const [created, active, done, failed] = await Promise.all([
        tasksRef.where("lifecycle", "==", "created").count().get(),
        tasksRef.where("lifecycle", "==", "active").count().get(),
        tasksRef.where("lifecycle", "==", "done").count().get(),
        tasksRef.where("lifecycle", "==", "failed").count().get(),
      ]);
      restResponse(res, true, {
        created: created.data().count,
        active: active.data().count,
        done: done.data().count,
        failed: failed.data().count,
        total: created.data().count + active.data().count + done.data().count + failed.data().count,
      });
    }
  }),
  route("GET", "/v1/tasks", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_tasks", query);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "create_task", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/tasks/:id", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "get_task_by_id", { taskId: p.id });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/:id/claim", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "claim_task", { taskId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/:id/complete", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "complete_task", { taskId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/:id/telemetry", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "record_task_telemetry", { taskId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/:id/unclaim", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "unclaim_task", { taskId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/batch-claim", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "batch_claim_tasks", body);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/batch-complete", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "batch_complete_tasks", body);
    restResponse(res, true, data);
  }),
  // Dispatch meta-tool
  route("POST", "/v1/dispatch", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "dispatch", body);
    restResponse(res, true, data, 201);
  }),
  // Relay
  route("GET", "/v1/messages/unread", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    // RD-5 PR-M row 1: the inbox read is get_messages (authorizeRelayRead decides). The subject defaults to the principal, never to
    // the whole tenant. markAsRead:false keeps this a peek. 21.1 C2: the route still answers { messages, count }, newest first, at most 50.
    const data = await callTool(auth, req, "get_messages", { sessionId: (query.sessionId as string) || credentialPrincipal(auth), markAsRead: false }) as {
      success?: boolean; interrupts?: Array<{ createdAt?: string | null }>;
    };
    if (data.success === false) return restResponse(res, true, data);
    const messages = [...(data.interrupts ?? [])]
      .sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""))
      .slice(0, 50);
    restResponse(res, true, { messages, count: messages.length });
  }),
  route("POST", "/v1/messages/mark_read", async (auth, req, res) => {
    await enforceBreaker(auth, "relay_mark_read");
    const body = await readBody(req);
    const messageIds = body.messageIds as string[];
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return restResponse(res, false, { code: "VALIDATION_ERROR", message: "messageIds must be a non-empty array" }, 400);
    }
    const { markReadHandler } = await import("../modules/relay.js");
    const validIds = messageIds.filter((id) => typeof id === "string" && id !== "");
    if (validIds.length === 0) {
      return restResponse(res, false, { code: "VALIDATION_ERROR", message: "messageIds must contain at least one non-empty string id" }, 400);
    }
    const out = await markReadHandler(auth, validIds);
    if (out.denied.length > 0 && out.updated === 0) {
      return restResponse(res, false, { code: "FORBIDDEN", message: out.denied[0].error, denied: out.denied }, 403);
    }
    restResponse(res, true, out);
  }),
  route("GET", "/v1/messages", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_messages", { sessionId: query.sessionId || "rest", ...query });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/messages", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "send_message", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/dead-letters", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_dead_letters", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/relay/groups", async (auth, req, res) => {
    const data = await callTool(auth, req, "list_groups", {});
    restResponse(res, true, data);
  }),
  // Portal owner send-message — Identity Sovereignty inv.6: source is server-derived, never client-supplied.
  route("POST", "/v1/relay/messages", async (auth, req, res) => {
    if (!auth.apiKeyHash.startsWith("firebase:")) {
      sendJson(res, 403, { success: false, error: "PORTAL_OWNER_ONLY", message: "This endpoint requires a Firebase owner ID token." });
      return;
    }
    // RD-5 PR-M row 13 (NL-REST-RELAY-MOBILE): bound to the credential's own principal, and the refusal is logged and names the caller.
    const caller = credentialPrincipal(auth);
    if (caller === "mobile") {
      logDenial({ principal: denialPrincipal(auth), tool: "relay_send_message", subject: null, code: "NOT_OWNER" });
      sendJson(res, 403, { success: false, error: "OWNER_REQUIRED", message: `This endpoint is restricted to Grid Portal owners; "${caller}" is not one.` });
      return;
    }
    const body = await readBody(req);
    // PR-2: adopted credentialPrincipal — identical to the prior inline
    // `auth.keyProgramId ?? auth.programId`, now the single named primitive.
    const source = credentialPrincipal(auth);
    try {
      const parsed = await callTool(auth, req, "relay_send_message", { ...body, source }) as { success?: boolean };
      restResponse(res, parsed.success !== false, parsed, parsed.success !== false ? 201 : 400);
    } catch (err) {
      // Rate limit / compliance / pricing / breaker denials carry their own typed
      // status+headers handling in the top-level route dispatcher — let those bubble.
      if (err instanceof ComplianceError || err instanceof PricingError || err instanceof BreakerError ||
          (err instanceof Error && (err as any).rateLimitResult)) {
        throw err;
      }
      if (err instanceof Error && err.message.includes("Source mismatch")) {
        sendJson(res, 403, { success: false, error: "SOURCE_MISMATCH", message: err.message });
      } else {
        sendJson(res, 500, { success: false, error: "INTERNAL", message: "Internal server error" });
      }
    }
  }),
  route("GET", "/v1/messages/sent", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_sent_messages", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/messages/history", async (auth, req, res) => {
    // ADR-013: no admin pre-gate — participant scoping in
    // queryMessageHistoryHandler is the single source of truth for both
    // transports (SARK C2). Non-admin callers get their own messages only.
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "query_message_history", query);
    restResponse(res, true, data);
  }),
  // Pulse
  route("GET", "/v1/sessions", async (auth, req, res) => {
    // RD-5 PR-M row 4: list_sessions decides (pulse.ts PR-L row 4); the admin pre-gate is gone.
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "list_sessions", query);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/sessions", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "create_session", body);
    // Reset compliance so DEREZED transport sessions can start fresh
    const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
    if (mcpSessionId) resetTransportCompliance(auth.userId, mcpSessionId);
    restResponse(res, true, data, 201);
  }),
  route("PATCH", "/v1/sessions/:id", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "update_session", { sessionId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/sessions/history", async (auth, req, res) => {
    // RD-5 PR-M row 5 (M-D2): list_sessions with includeArchived decides who reads which program's sessions; the route keeps
    // its `sessions` key and its field names, and keeps only archived rows. list_sessions caps a page at 50, so this route does too.
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    const data = await callTool(auth, req, "list_sessions", { includeArchived: true, limit: 50 }) as {
      success?: boolean; sessions?: Array<Record<string, unknown>>;
    };
    if (data.success === false) return restResponse(res, true, data);
    const sessions = (data.sessions ?? []).filter((s) => s.archived === true).slice(0, limit).map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      programId: s.programId,
      status: s.status,
      state: s.state,
      progress: s.progress,
      projectName: s.projectName,
      durationMs: null, // list_sessions does not return createdAt; reported to ISO (PR-M surprise)
      durationMinutes: null,
      createdAt: null,
      completedAt: s.lastUpdate ?? null,
    }));
    restResponse(res, true, { sessions, count: sessions.length });
  }),
  // Signal
  route("POST", "/v1/questions", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "ask_question", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/questions/:id/response", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "get_response", { questionId: p.id });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/alerts", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "send_alert", body);
    restResponse(res, true, data, 201);
  }),
  // Sprint
  route("POST", "/v1/sprints", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "create_sprint", body);
    restResponse(res, true, data, 201);
  }),
  route("PATCH", "/v1/sprints/:id/stories/:sid", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "update_sprint_story", { sprintId: p.id, storyId: p.sid, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/sprints/:id/stories", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "add_story_to_sprint", { sprintId: p.id, ...body });
    restResponse(res, true, data, 201);
  }),
  route("POST", "/v1/sprints/:id/complete", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "complete_sprint", { sprintId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/sprints/active", async (auth, req, res) => {
    // RD-5 PR-M row 6 (GATE sprint_get_sprint): the capability gate, then each sprint must pass mayActOnSprint(read) on
    // credentialPrincipal(auth). A sprint the caller may not read is dropped from the list; there is no per-item denial.
    await enforceBreaker(auth, "sprint_get_sprint");
    const principal = credentialPrincipal(auth);
    const db = getFirestore();
    const tasksRef = db.collection(`tenants/${auth.userId}/tasks`);
    const snap = await tasksRef
      .where("type", "==", "sprint")
      .where("status", "in", ["created", "active"])
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    const { mayActOnSprint } = await import("../modules/sprint.js");
    const readable = snap.docs.filter((doc: any) => mayActOnSprint(auth, principal, doc.data(), "read"));
    const sprints = await Promise.all(readable.map(async (doc: any) => {
      const data = doc.data();
      // Fetch stories for this sprint
      const storiesSnap = await tasksRef
        .where("type", "==", "sprint-story")
        .where("sprint.parentId", "==", doc.id)
        .get();

      const stories = storiesSnap.docs.map((s: any) => {
        const sd = s.data();
        return {
          id: s.id,
          title: sd.title,
          status: sd.status,
          wave: sd.sprint?.wave || 1,
          dependencies: sd.sprint?.dependencies || [],
          complexity: sd.sprint?.complexity || "normal",
          currentAction: sd.sprint?.currentAction || null,
          startedAt: sd.startedAt?.toDate?.()?.toISOString() || null,
          completedAt: sd.completedAt?.toDate?.()?.toISOString() || null,
        };
      });

      const stats = {
        total: stories.length,
        completed: stories.filter((s: any) => s.status === "done").length,
        failed: stories.filter((s: any) => s.status === "failed").length,
        active: stories.filter((s: any) => s.status === "active").length,
        queued: stories.filter((s: any) => s.status === "created").length,
      };

      return {
        id: doc.id,
        title: data.title,
        status: data.status,
        projectName: data.sprint?.projectName,
        branch: data.sprint?.branch,
        config: data.sprint?.config || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        startedAt: data.startedAt?.toDate?.()?.toISOString() || null,
        stories,
        stats,
      };
    }));

    restResponse(res, true, { sprints, count: sprints.length });
  }),
  route("GET", "/v1/sprints/:id", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "get_sprint", { sprintId: p.id });
    restResponse(res, true, data);
  }),
  // Budget
  route("GET", "/v1/budget/summary", async (auth, req, res) => {
    // RD-5 PR-M row 8 (CAP metrics_get_cost_summary, M-D4): metrics.read; the summary is a tenant aggregate.
    await enforceBreaker(auth, "metrics_get_cost_summary");
    const { budgetSummaryHandler } = await import("../modules/budget.js");
    const result = await budgetSummaryHandler(auth, {});
    const text = result?.content?.[0]?.text;
    restResponse(res, true, text ? JSON.parse(text) : result);
  }),

  // Metrics
  route("GET", "/v1/metrics/cost-summary", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_cost_summary", query);
    restResponse(res, true, data);
  }),

  // Metrics
  route("GET", "/v1/metrics/comms", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_comms_metrics", query);
    restResponse(res, true, data);
  }),

  route("GET", "/v1/metrics/operational", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_operational_metrics", query);
    restResponse(res, true, data);
  }),
  // Fleet
  route("GET", "/v1/fleet/health", async (auth, req, res) => {
    const data = await callTool(auth, req, "get_fleet_health", {});
    restResponse(res, true, data);
  }),
  route("POST", "/v1/fleet/snapshots", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "write_fleet_snapshot", body);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/fleet/timeline", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_fleet_timeline", query);
    restResponse(res, true, data);
  }),
  // Dream
  route("GET", "/v1/dreams", async (auth, req, res) => {
    // RD-5 PR-M row 9 (CALL dream_peek): dream.read through callTool; the handler is unchanged.
    const data = await callTool(auth, req, "dream_peek", {});
    restResponse(res, true, data);
  }),
  route("POST", "/v1/dreams/:id/activate", async (auth, req, res, p) => {
    const result = await callTool(auth, req, "dream_activate", { dreamId: p.id });
    restResponse(res, true, result);
  }),


  // GSP
  route("POST", "/v1/gsp/read", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "gsp_read", body);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/gsp/write", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "gsp_write", body);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/gsp/namespaces", async (auth, req, res) => {
    // RD-5 PR-M row 10 (CAP gsp_read): gsp.read; the namespace list is tenant-wide.
    await enforceBreaker(auth, "gsp_read");
    const data = await gspListNamespacesHandler(auth);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/gsp/namespaces/:namespace/entries", async (auth, req, res, p) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "gsp_read", { namespace: p.namespace, ...query });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/gsp/entries/:namespace/:key", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "gsp_read", { namespace: p.namespace, key: p.key });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/gsp/search", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "gsp_search", body);
    restResponse(res, true, data);
  }),
  // GSP Proposals — list pending proposals for the authenticated tenant
  route("GET", "/v1/gsp/proposals", async (auth, req, res) => {
    // RD-5 PR-M row 7 (CAP gsp_read, M-D3): gsp.read; proposals are tenant-wide governance records, gsp_resolve decides who acts (PR-N).
    await enforceBreaker(auth, "gsp_read");
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const db = getFirestore();
    const colRef = db.collection(`tenants/${auth.userId}/gsp_proposals`);
    const status = query.status as string | undefined;
    let q: Query = colRef;
    if (status) {
      q = q.where("status", "==", status);
    }
    q = q.orderBy("createdAt", "desc").limit(50);
    const snap = await q.get();
    const proposals = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        namespace: d.namespace,
        key: d.key,
        proposedValue: d.proposedValue,
        proposedBy: d.proposedBy,
        status: d.status,
        rationale: d.rationale,
        reviewers: d.reviewers,
        approvalChain: d.approvalChain,
        createdAt: d.createdAt?.toDate?.()?.toISOString() || d.createdAt,
        resolvedAt: d.resolvedAt?.toDate?.()?.toISOString() || d.resolvedAt || null,
        expiresAt: d.expiresAt,
      };
    });
    restResponse(res, true, { proposals, count: proposals.length });
  }),
  // GSP Resolve — approve, reject, or withdraw a proposal
  route("POST", "/v1/gsp/proposals/:id/resolve", async (auth, req, res, p) => {
    const body = await readBody(req);
    const parsed = await callTool(auth, req, "gsp_resolve", { proposalId: p.id, ...body }) as { success?: boolean };
    restResponse(res, parsed.success !== false, parsed, parsed.success !== false ? 200 : 400);
  }),

  // Program State
  route("GET", "/v1/program-state/:programId", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "get_program_state", { programId: p.programId });
    restResponse(res, true, data);
  }),
  route("PATCH", "/v1/program-state/:programId", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "update_program_state", { programId: p.programId, ...body });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/program-state/:programId/context-history", async (auth, req, res, p) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_context_history", { programId: p.programId, ...query });
    restResponse(res, true, data);
  }),

  // Memory (Phase 1)
  route("POST", "/v1/memory/:programId/patterns", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "store_memory", { programId: p.programId, ...body });
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/memory/:programId/patterns", async (auth, req, res, p) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "recall_memory", { programId: p.programId, ...query });
    restResponse(res, true, data);
  }),
  route("DELETE", "/v1/memory/:programId/patterns/:patternId", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "delete_memory", { programId: p.programId, patternId: p.patternId });
    restResponse(res, true, data);
  }),
  route("PATCH", "/v1/memory/:programId/patterns/:patternId/reinforce", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "reinforce_memory", { programId: p.programId, patternId: p.patternId, ...body });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/memory/:programId/health", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "memory_health", { programId: p.programId });
    restResponse(res, true, data);
  }),

  // Keys
  route("POST", "/v1/keys", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "create_key", body);
    restResponse(res, true, data, 201);
  }),
  route("DELETE", "/v1/keys/:hash", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "revoke_key", { keyHash: p.hash });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/keys", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "list_keys", query);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/keys/rotate", async (auth, req, res) => {
    const data = await callTool(auth, req, "rotate_key", {});
    restResponse(res, true, data);
  }),

  // Audit
  route("GET", "/v1/audit", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_audit", query);
    restResponse(res, true, data);
  }),

  // Legacy redirects
  route("GET", "/v1/interrupts/peek", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_messages", { sessionId: query.sessionId || "peek", markAsRead: false });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/dreams/peek", async (auth, req, res) => {
    // RD-5 PR-M row 9 (CALL dream_peek): dream.read through callTool; the handler is unchanged.
    const data = await callTool(auth, req, "dream_peek", {});
    restResponse(res, true, data);
  }),
  route("POST", "/v1/dreams/activate", async (auth, req, res) => {
    const body = await readBody(req);
    const result = await callTool(auth, req, "dream_activate", body);
    restResponse(res, true, result);
  }),

  // Traces
  route("GET", "/v1/traces", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "query_traces", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/traces/:traceId", async (auth, req, res, p) => {
    const data = await callTool(auth, req, "query_trace", { traceId: p.traceId });
    restResponse(res, true, data);
  }),

  // Feedback
  route("POST", "/v1/feedback", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "submit_feedback", body);
    restResponse(res, true, data, 201);
  }),

  // Rate Limits
  route("POST", "/v1/rate-limits", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "log_rate_limit_event", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/rate-limits", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_rate_limit_events", query);
    restResponse(res, true, data);
  }),

  // Additional Metrics
  route("GET", "/v1/metrics/contention", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_contention_metrics", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/metrics/context-utilization", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_context_utilization", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/metrics/ack-compliance", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_ack_compliance", query);
    restResponse(res, true, data);
  }),

  // Usage & Billing
  route("GET", "/v1/usage", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_usage", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/invoices", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_invoice", query);
    restResponse(res, true, data);
  }),
  route("PUT", "/v1/budget", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, req, "set_budget", body);
    restResponse(res, true, data);
  }),
];

// OpenAPI spec cache (1 hour TTL)
let cachedOpenApiSpec: { spec: any; timestamp: number } | null = null;
const OPENAPI_CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

export function createRestRouter(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req, res) => {
    const url = (req.url || "").split("?")[0];
    const method = req.method || "GET";

    // Public endpoint: enrollment token exchange — no cb_ key yet (that's what it returns).
    // ⛔ SARK G-4: code reviewed before exposure. ⛔ G-1: LB+Armor must be live first.
    if (url === "/enroll") {
      return await enrollHandler(req, res);
    }

    // Public endpoint: OpenAPI spec (no auth required)
    if (method === "GET" && url === "/v1/openapi.json") {
      const now = Date.now();
      if (!cachedOpenApiSpec || now - cachedOpenApiSpec.timestamp > OPENAPI_CACHE_TTL) {
        cachedOpenApiSpec = {
          spec: generateOpenApiSpec(),
          timestamp: now,
        };
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(JSON.stringify(cachedOpenApiSpec.spec, null, 2));
      return;
    }

    // Auth
    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      checkAuthRateLimit(clientIp);
      return restResponse(res, false, { code: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }
    let auth: AuthContext | null;
    try {
      auth = await validateAuth(token);
    } catch (err) {
      if (!(err instanceof TenantResolutionError)) throw err;
      res.setHeader("Retry-After", "5");
      return restResponse(res, false, { code: "TENANT_RESOLUTION_FAILED", message: "tenant resolution failed", retryable: true }, 503);
    }
    if (!auth) {
      // Only count FAILED auth attempts against IP rate limit
      if (!checkAuthRateLimit(clientIp)) {
        res.setHeader("Retry-After", "60");
        return restResponse(res, false, { code: "RATE_LIMITED", message: "Too many authentication attempts", retryAfter: 60 }, 429);
      }
      return restResponse(res, false, { code: "UNAUTHORIZED", message: "Invalid API key" }, 401);
    }

    // Route matching
    for (const r of routes) {
      if (r.method !== method) continue;
      const match = url.match(r.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });

      try {
        return await r.handler(auth, req, res, params);
      } catch (err) {
        if (err instanceof ValidationError) {
          return restResponse(res, false, {
            code: "VALIDATION_ERROR",
            message: err.message,
            issues: err.issues,
          }, 400);
        }
        if (err instanceof Error && (err as any).rateLimitResult) {
          const rl = (err as any).rateLimitResult;
          res.setHeader("Retry-After", String(rl.retryAfter || 60));
          res.setHeader("X-RateLimit-Limit", String(rl.limit));
          res.setHeader("X-RateLimit-Remaining", "0");
          res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt.getTime() / 1000)));
          return restResponse(res, false, {
            code: "RATE_LIMITED",
            message: err.message,
            retryAfter: rl.retryAfter,
          }, 429);
        }
        if (err instanceof ComplianceError) {
          return restResponse(res, false, {
            code: err.code,
            message: err.message,
          }, err.code === "SESSION_TERMINATED" ? 410 : 403);
        }
        if (err instanceof PricingError) {
          return restResponse(res, false, {
            code: "PRICING_LIMIT_REACHED",
            message: err.message,
          }, 402);
        }
        if (err instanceof CapabilityError) {
          return restResponse(res, false, {
            code: err.code,
            message: err.message,
          }, 403);
        }
        if (err instanceof BreakerError) {
          res.setHeader("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
          const status = err.code === "CEILING_ORG_PAUSED" || err.code === "DISPATCH_PAUSED" || err.code === "CEILING_CONFIG_UNAVAILABLE" ? 503 : 429;
          return restResponse(res, false, {
            code: err.code,
            message: err.message,
          }, status);
        }
        return restResponse(res, false, {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        }, 500);
      }
    }

    restResponse(res, false, { code: "NOT_FOUND", message: `${method} ${url} not found` }, 404);
  };
}
