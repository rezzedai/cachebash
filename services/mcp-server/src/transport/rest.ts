/**
 * REST Transport — Full MCP-REST parity.
 * Every MCP tool has a corresponding REST endpoint.
 */

import http from "http";
import { ZodError } from "zod";
import { validateAuth, type AuthContext } from "../auth/authValidator.js";
import { TOOL_HANDLERS } from "../tools.js";
import { logToolCall } from "../modules/ledger.js";
import { traceToolCall } from "../modules/trace.js";
import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { generateCorrelationId, createAuditLogger } from "../middleware/gate.js";
import { dreamPeekHandler, dreamActivateHandler } from "../modules/dream.js";
import { enforceRateLimit, checkAuthRateLimit } from "../middleware/rateLimiter.js";
import { checkSessionCompliance, resetTransportCompliance, clearComplianceCache } from "../middleware/sessionCompliance.js";
import { checkPricing } from "../middleware/pricingEnforce.js";
import { incrementUsage } from "../middleware/usage.js";

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

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractBearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

const MAX_BODY_SIZE = 64 * 1024; // 64KB
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
const BOOLEAN_FIELDS = new Set(['markAsRead', 'includeArchived', 'includeRevoked', 'allowed', 'encrypt', 'lastHeartbeat']);

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

/** Admin gate — requires wildcard capability or admin-class programId */
function requireAdmin(auth: AuthContext, res: http.ServerResponse): boolean {
  if (auth.capabilities.includes("*") || ["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return true;
  }
  restResponse(res, false, { code: "FORBIDDEN", message: "Admin access required" }, 403);
  return false;
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
  // Per-key + per-tenant + per-tool rate limiting (SPEC 2)
  const rateResult = enforceRateLimit(auth.userId, auth.apiKeyHash, toolName);
  if (!rateResult.allowed) {
    const err = new Error(`Rate limit exceeded for ${toolName}. Try again in ${rateResult.retryAfter}s.`);
    (err as any).rateLimitResult = rateResult;
    throw err;
  }

  // Phase 4: Capability gate
  const { checkToolCapability } = await import("../middleware/capabilities.js");
  const capCheck = checkToolCapability(toolName, auth.capabilities);
  if (!capCheck.allowed) {
    throw new Error(
      `Insufficient capability: ${toolName} requires "${capCheck.required}" but key has [${capCheck.held.join(", ")}]`
    );
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

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new Error(`Unknown tool: ${toolName}`);
  const start = Date.now();
  const correlationId = generateCorrelationId();
  const audit = createAuditLogger(correlationId, auth.userId);
  try {
    const result = await handler(auth, args);
    logToolCall(auth.userId, toolName, auth.programId, "rest", undefined, Date.now() - start, true);
    traceToolCall(auth.userId, toolName, auth.programId, "rest", undefined, args,
      JSON.stringify(result).substring(0, 500), Date.now() - start, true);
    audit.log(toolName, { tool: toolName, programId: auth.programId, source: auth.programId, endpoint: "rest" });
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
    logToolCall(auth.userId, toolName, auth.programId, "rest", undefined, Date.now() - start, false,
      err instanceof Error ? err.message : String(err));
    traceToolCall(auth.userId, toolName, auth.programId, "rest", undefined, args,
      "", Date.now() - start, false, err instanceof Error ? err.message : String(err));
    audit.error(toolName, err instanceof Error ? err.message : String(err), { tool: toolName, programId: auth.programId, source: auth.programId, endpoint: "rest" });
    throw err;
  }
}

const routes: Route[] = [
  // Dispatch
  route("GET", "/v1/tasks/stats", async (auth, req, res) => {
    if (!requireAdmin(auth, res)) return;
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const db = getFirestore();
    const tasksRef = db.collection(`tenants/${auth.userId}/tasks`);
    const target = query.target as string | undefined;
    const period = query.period as string | undefined;

    if (target || (period && period !== "all")) {
      // Filtered: fetch docs and count in memory to avoid composite index issues
      let q: admin.firestore.Query = tasksRef;
      if (target) q = q.where("target", "==", target);
      if (period && period !== "all") {
        q = q.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(periodStart(period)));
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
        ...(target ? { target } : {}),
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
  // Relay
  route("GET", "/v1/messages/unread", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const db = getFirestore();
    const relayRef = db.collection(`tenants/${auth.userId}/relay`);
    let q: admin.firestore.Query = relayRef.where("status", "==", "pending");
    if (query.sessionId) {
      q = q.where("target", "==", query.sessionId);
    }
    const snap = await q.orderBy("createdAt", "desc").limit(50).get();
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    restResponse(res, true, { messages, count: messages.length });
  }),
  route("POST", "/v1/messages/mark_read", async (auth, req, res) => {
    const body = await readBody(req);
    const messageIds = body.messageIds as string[];
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return restResponse(res, false, { code: "VALIDATION_ERROR", message: "messageIds must be a non-empty array" }, 400);
    }
    const db = getFirestore();
    const batch = db.batch();
    for (const id of messageIds.slice(0, 100)) {
      batch.update(db.doc(`tenants/${auth.userId}/relay/${id}`), {
        status: "read",
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    restResponse(res, true, { updated: Math.min(messageIds.length, 100) });
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
  route("GET", "/v1/messages/sent", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "get_sent_messages", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/messages/history", async (auth, req, res) => {
    if (!requireAdmin(auth, res)) return;
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, req, "query_message_history", query);
    restResponse(res, true, data);
  }),
  // Pulse
  route("GET", "/v1/sessions", async (auth, req, res) => {
    if (!requireAdmin(auth, res)) return;
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
    if (!requireAdmin(auth, res)) return;
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const db = getFirestore();
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    const snap = await db.collection(`tenants/${auth.userId}/sessions`)
      .where("archived", "==", true)
      .orderBy("lastUpdate", "desc")
      .limit(limit)
      .get();

    const sessions = snap.docs.map(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.()?.getTime() || 0;
      const lastUpdate = data.lastUpdate?.toDate?.()?.getTime() || 0;
      const durationMs = lastUpdate && createdAt ? lastUpdate - createdAt : null;

      return {
        sessionId: doc.id,
        name: data.name,
        programId: data.programId,
        status: data.currentAction || data.name,
        state: data.status,
        progress: data.progress,
        projectName: data.projectName,
        durationMs,
        durationMinutes: durationMs ? Math.round(durationMs / 60000) : null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        completedAt: data.lastUpdate?.toDate?.()?.toISOString() || null,
      };
    });

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
    if (!requireAdmin(auth, res)) return;
    const db = getFirestore();
    const tasksRef = db.collection(`tenants/${auth.userId}/tasks`);
    const snap = await tasksRef
      .where("type", "==", "sprint")
      .where("status", "in", ["created", "active"])
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    const sprints = await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data();
      // Fetch stories for this sprint
      const storiesSnap = await tasksRef
        .where("type", "==", "sprint-story")
        .where("sprint.parentId", "==", doc.id)
        .get();

      const stories = storiesSnap.docs.map(s => {
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
        completed: stories.filter(s => s.status === "done").length,
        failed: stories.filter(s => s.status === "failed").length,
        active: stories.filter(s => s.status === "active").length,
        queued: stories.filter(s => s.status === "created").length,
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
    const result = await dreamPeekHandler(auth, {});
    const text = result?.content?.[0]?.text;
    restResponse(res, true, text ? JSON.parse(text) : result);
  }),
  route("POST", "/v1/dreams/:id/activate", async (auth, req, res, p) => {
    const result = await dreamActivateHandler(auth, { dreamId: p.id });
    const text = result?.content?.[0]?.text;
    restResponse(res, true, text ? JSON.parse(text) : result);
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
    const result = await dreamPeekHandler(auth, {});
    const text = result?.content?.[0]?.text;
    restResponse(res, true, text ? JSON.parse(text) : result);
  }),
  route("POST", "/v1/dreams/activate", async (auth, req, res) => {
    const body = await readBody(req);
    const result = await dreamActivateHandler(auth, body);
    const text = result?.content?.[0]?.text;
    restResponse(res, true, text ? JSON.parse(text) : result);
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

  // Admin
  route("POST", "/admin/reset-program-cache", async (auth, req, res) => {
    if (!auth.capabilities.includes("*")) {
      return restResponse(res, false, { code: "FORBIDDEN", message: "Admin access required" }, 403);
    }
    const body = await readBody(req);
    const programId = body.programId as string | undefined;
    if (!programId || typeof programId !== "string") {
      return restResponse(res, false, { code: "VALIDATION_ERROR", message: "programId is required" }, 400);
    }

    const found = clearComplianceCache(programId);

    // Audit log
    const correlationId = generateCorrelationId();
    const audit = createAuditLogger(correlationId, auth.userId);
    audit.log("admin.reset_program_cache", {
      programId,
      source: auth.programId,
      endpoint: "rest",
    });

    restResponse(res, true, {
      success: true,
      programId,
      cacheEntryFound: found,
      message: found ? "Cache cleared" : "No cache entry found (idempotent)",
    });
  }),
];

export function createRestRouter(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req, res) => {
    const url = (req.url || "").split("?")[0];
    const method = req.method || "GET";

    // Auth
    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      checkAuthRateLimit(clientIp);
      return restResponse(res, false, { code: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }
    const auth = await validateAuth(token);
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
        return restResponse(res, false, {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        }, 500);
      }
    }

    restResponse(res, false, { code: "NOT_FOUND", message: `${method} ${url} not found` }, 404);
  };
}
