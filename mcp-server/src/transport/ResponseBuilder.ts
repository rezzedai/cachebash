import { TransportResponse } from "./types.js";

export function jsonResponse(data: unknown, status = 200, sessionId?: string): TransportResponse {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return { status, headers, body: JSON.stringify(data) };
}

export function jsonRpcError(
  code: number,
  message: string,
  id: string | number | null,
  data?: string
): TransportResponse {
  const error: Record<string, unknown> = { code, message };
  if (data) error.data = data;
  return jsonResponse({ jsonrpc: "2.0", error, id }, code === -32600 ? 400 : 500);
}

export function unauthorizedResponse(message: string): TransportResponse {
  return jsonResponse({ error: message }, 401);
}

export function notAcceptableResponse(message: string): TransportResponse {
  return jsonResponse({ error: message }, 406);
}

export function internalErrorResponse(message: string): TransportResponse {
  return jsonResponse({ jsonrpc: "2.0", error: { code: -32603, message }, id: null }, 500);
}
