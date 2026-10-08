import type { World, WorldCredential } from "./world";

export type Transport = "mcp" | "iso";
const PATHS: Record<Transport, string> = { mcp: "/v1/mcp", iso: "/v1/iso/mcp" };

export interface ToolResult {
  httpStatus: number;
  isError: boolean;
  /** concatenated text content of the result, or the raw body when the transport answered with an error */
  text: string;
  /** text parsed as JSON when it is JSON, else undefined */
  json: any;
}

async function post(world: World, transport: Transport, key: string, body: unknown, sessionId?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${key}`,
    ...extraHeaders,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(`${world.baseUrl}${PATHS[transport]}`, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // SSE-style framing: take the last data: line
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    if (lines.length) {
      try {
        parsed = JSON.parse(lines[lines.length - 1].slice(5).trim());
      } catch {
        /* leave undefined */
      }
    }
  }
  return { status: res.status, headers: res.headers, raw, parsed };
}

let rpcId = 1;

/**
 * One tool call as `cred`, in a fresh MCP session (a session per call keeps the per-session compliance
 * counters from leaking between probes). `extraHeaders` is how probe H sends the override header.
 */
export async function callTool(
  world: World,
  cred: WorldCredential,
  tool: string,
  args: Record<string, unknown> = {},
  opts: { transport?: Transport; headers?: Record<string, string> } = {}
): Promise<ToolResult> {
  const transport = opts.transport ?? "mcp";
  const init = await post(world, transport, cred.key, {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rd5-probe", version: "1" } },
  }, undefined, opts.headers);
  if (init.status !== 200) {
    return { httpStatus: init.status, isError: true, text: init.raw, json: init.parsed };
  }
  const sessionId = init.headers.get("mcp-session-id") ?? undefined;
  const call = await post(world, transport, cred.key, {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "tools/call",
    params: { name: tool, arguments: args },
  }, sessionId, opts.headers);
  const result = call.parsed?.result;
  if (!result) {
    return { httpStatus: call.status, isError: true, text: call.raw, json: call.parsed };
  }
  const text = (result.content ?? []).map((c: any) => c?.text ?? "").join("\n");
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { httpStatus: call.status, isError: !!result.isError, text, json };
}

/** tools/list as `cred` (what the transport shows that credential). */
export async function listTools(world: World, cred: WorldCredential, transport: Transport = "mcp"): Promise<string[]> {
  const init = await post(world, transport, cred.key, {
    jsonrpc: "2.0", id: rpcId++, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rd5-probe", version: "1" } },
  });
  const sessionId = init.headers.get("mcp-session-id") ?? undefined;
  const r = await post(world, transport, cred.key, { jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} }, sessionId);
  return (r.parsed?.result?.tools ?? []).map((t: any) => t.name as string);
}

/** Plain HTTP GET/POST helper for REST routes (Bearer only; the REST router reads no override header). */
export async function rest(
  world: World, cred: WorldCredential, method: string, path: string, body?: unknown
): Promise<{ httpStatus: number; text: string; json: any }> {
  const res = await fetch(`${world.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { /* plain */ }
  return { httpStatus: res.status, text, json };
}
