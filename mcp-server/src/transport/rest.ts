/**
 * REST Transport — Full MCP-REST parity.
 * Every MCP tool has a corresponding REST endpoint.
 */

import http from "http";
import { validateApiKey, type AuthContext } from "../auth/apiKeyValidator.js";
import { TOOL_HANDLERS } from "../tools.js";
import { logToolCall } from "../modules/ledger.js";
import { generateCorrelationId, createAuditLogger } from "../middleware/gate.js";
import { dreamPeekHandler, dreamActivateHandler } from "../modules/dream.js";

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractBearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
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

async function callTool(auth: AuthContext, toolName: string, args: unknown): Promise<unknown> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new Error(`Unknown tool: ${toolName}`);
  const start = Date.now();
  const correlationId = generateCorrelationId();
  const audit = createAuditLogger(correlationId, auth.userId);
  try {
    const result = await handler(auth, args);
    logToolCall(auth.userId, toolName, auth.programId, "rest", undefined, Date.now() - start, true);
    audit.log(toolName, { tool: toolName, programId: auth.programId, source: auth.programId, endpoint: "rest" });
    // Extract JSON from MCP tool result format
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : result;
  } catch (err) {
    logToolCall(auth.userId, toolName, auth.programId, "rest", undefined, Date.now() - start, false,
      err instanceof Error ? err.message : String(err));
    audit.error(toolName, err instanceof Error ? err.message : String(err), { tool: toolName, programId: auth.programId, source: auth.programId, endpoint: "rest" });
    throw err;
  }
}

const routes: Route[] = [
  // Dispatch
  route("GET", "/v1/tasks", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_tasks", query);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "create_task", body);
    restResponse(res, true, data, 201);
  }),
  route("POST", "/v1/tasks/:id/claim", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "claim_task", { taskId: p.id, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/tasks/:id/complete", async (auth, req, res, p) => {
    const data = await callTool(auth, "complete_task", { taskId: p.id });
    restResponse(res, true, data);
  }),
  // Relay
  route("GET", "/v1/messages", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_messages", { sessionId: query.sessionId || "rest", ...query });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/messages", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "send_message", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/dead-letters", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_dead_letters", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/relay/groups", async (auth, req, res) => {
    const data = await callTool(auth, "list_groups", {});
    restResponse(res, true, data);
  }),
  route("GET", "/v1/messages/sent", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_sent_messages", query);
    restResponse(res, true, data);
  }),
  route("GET", "/v1/messages/history", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "query_message_history", query);
    restResponse(res, true, data);
  }),
  // Pulse
  route("GET", "/v1/sessions", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "list_sessions", query);
    restResponse(res, true, data);
  }),
  route("POST", "/v1/sessions", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "create_session", body);
    restResponse(res, true, data, 201);
  }),
  route("PATCH", "/v1/sessions/:id", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "update_session", { sessionId: p.id, ...body });
    restResponse(res, true, data);
  }),
  // Signal
  route("POST", "/v1/questions", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "ask_question", body);
    restResponse(res, true, data, 201);
  }),
  route("GET", "/v1/questions/:id/response", async (auth, req, res, p) => {
    const data = await callTool(auth, "get_response", { questionId: p.id });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/alerts", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "send_alert", body);
    restResponse(res, true, data, 201);
  }),
  // Sprint
  route("POST", "/v1/sprints", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "create_sprint", body);
    restResponse(res, true, data, 201);
  }),
  route("PATCH", "/v1/sprints/:id/stories/:sid", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "update_sprint_story", { sprintId: p.id, storyId: p.sid, ...body });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/sprints/:id/stories", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "add_story_to_sprint", { sprintId: p.id, ...body });
    restResponse(res, true, data, 201);
  }),
  route("POST", "/v1/sprints/:id/complete", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "complete_sprint", { sprintId: p.id, ...body });
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
    const data = await callTool(auth, "get_cost_summary", query);
    restResponse(res, true, data);
  }),

  // Metrics
  route("GET", "/v1/metrics/comms", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_comms_metrics", query);
    restResponse(res, true, data);
  }),
  // Fleet
  route("GET", "/v1/fleet/health", async (auth, req, res) => {
    const data = await callTool(auth, "get_fleet_health", {});
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
    const data = await callTool(auth, "get_program_state", { programId: p.programId });
    restResponse(res, true, data);
  }),
  route("PATCH", "/v1/program-state/:programId", async (auth, req, res, p) => {
    const body = await readBody(req);
    const data = await callTool(auth, "update_program_state", { programId: p.programId, ...body });
    restResponse(res, true, data);
  }),

  // Keys
  route("POST", "/v1/keys", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "create_key", body);
    restResponse(res, true, data, 201);
  }),
  route("DELETE", "/v1/keys/:hash", async (auth, req, res, p) => {
    const data = await callTool(auth, "revoke_key", { keyHash: p.hash });
    restResponse(res, true, data);
  }),
  route("GET", "/v1/keys", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "list_keys", query);
    restResponse(res, true, data);
  }),

  // Audit
  route("GET", "/v1/audit", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_audit", query);
    restResponse(res, true, data);
  }),

  // Legacy redirects
  route("GET", "/v1/interrupts/peek", async (auth, req, res) => {
    const query = coerceQueryParams(parseQuery(req.url || ""));
    const data = await callTool(auth, "get_messages", { sessionId: query.sessionId || "peek", markAsRead: false });
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
];

export function createRestRouter(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req, res) => {
    const url = (req.url || "").split("?")[0];
    const method = req.method || "GET";

    // Auth
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return restResponse(res, false, { code: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    const auth = await validateApiKey(token);
    if (!auth) return restResponse(res, false, { code: "UNAUTHORIZED", message: "Invalid API key" }, 401);

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
        return restResponse(res, false, {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        }, 500);
      }
    }

    restResponse(res, false, { code: "NOT_FOUND", message: `${method} ${url} not found` }, 404);
  };
}
