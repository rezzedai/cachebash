import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

interface ParseResult {
  success: boolean;
  message?: JSONRPCMessage | JSONRPCMessage[];
  error?: { code: number; message: string; data?: string };
}

export function parseJsonBody(body: string | null): ParseResult {
  if (!body) {
    return { success: false, error: { code: -32600, message: "Invalid Request: empty body" } };
  }

  try {
    const parsed = JSON.parse(body);
    return { success: true, message: parsed };
  } catch {
    return { success: false, error: { code: -32700, message: "Parse error: invalid JSON" } };
  }
}

export function isInitializeRequest(message: JSONRPCMessage): boolean {
  return "method" in message && message.method === "initialize";
}
