/**
 * REST Transport — Full MCP-REST parity.
 * Every MCP tool has a corresponding REST endpoint.
 */

import http from "http";
import { validateApiKey, type AuthContext } from "../auth/apiKeyValidator.js";
import { TOOL_HANDLERS } from "../tools.js";
import { logToolCall } from "../modules/ledger.js";
import { generateCorrelationId } from "../middleware/gate.js";
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
  try {
    const result = await handler(auth, args);
    logToolCall(auth.userId, toolName, "rest", undefined, Date.now() - start, true);
    // Extract JSON from MCP tool result format
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : result;
  } catch (err) {
    logToolCall(auth.userId, toolName, "rest", undefined, Date.now() - start, false,
      err instanceof Error ? err.message : String(err));
    throw err;
  }
}

const routes: Route[] = [
  // Dispatch
  route("GET", "/v1/tasks", async (auth, req, res) => {
    const query = parseQuery(req.url || "");
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
    const query = parseQuery(req.url || "");
    const data = await callTool(auth, "get_messages", { sessionId: query.sessionId || "rest", ...query });
    restResponse(res, true, data);
  }),
  route("POST", "/v1/messages", async (auth, req, res) => {
    const body = await readBody(req);
    const data = await callTool(auth, "send_message", body);
    restResponse(res, true, data, 201);
  }),
  // Pulse
  route("GET", "/v1/sessions", async (auth, req, res) => {
    const query = parseQuery(req.url || "");
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
    const query = parseQuery(req.url || "");
    const data = await callTool(auth, "list_keys", query);
    restResponse(res, true, data);
  }),
  // Legacy redirects
  route("GET", "/v1/interrupts/peek", async (auth, req, res) => {
    const query = parseQuery(req.url || "");
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
