/**
 * RD-5 PR-D: R11 probe logic (ISO plan section 9). The CLI is
 * scripts/rd5/probe-live-keys.ts.
 *
 * Per key: initialize an MCP session, then call `tools/list`. It calls no
 * tool: relay_get_messages drains by default and is never an auth probe. It
 * prints the hash prefix, never the key.
 */
import { createHash } from "crypto";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface ProbeRow {
  hashPrefix: string;
  status: number | "error";
  toolCount: number | "n/a";
}

export function hashPrefix(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 8);
}

function parseBody(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    if (!lines.length) return undefined;
    try {
      return JSON.parse(lines[lines.length - 1].slice(5).trim());
    } catch {
      return undefined;
    }
  }
}

export async function probeKey(fetchFn: FetchLike, baseUrl: string, rawKey: string): Promise<ProbeRow> {
  const prefix = hashPrefix(rawKey);
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/mcp`;
  const post = (body: unknown, sessionId?: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${rawKey}`,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    return fetchFn(url, { method: "POST", headers, body: JSON.stringify(body) });
  };
  try {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rd5-r11-probe", version: "1" } },
    });
    await init.text();
    if (init.status !== 200) return { hashPrefix: prefix, status: init.status, toolCount: "n/a" };
    const sessionId = init.headers.get("mcp-session-id") ?? undefined;
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
    const parsed = parseBody(await list.text());
    const tools = parsed?.result?.tools;
    return { hashPrefix: prefix, status: list.status, toolCount: Array.isArray(tools) ? tools.length : "n/a" };
  } catch {
    return { hashPrefix: prefix, status: "error", toolCount: "n/a" };
  }
}

export function formatProbeRow(r: ProbeRow): string {
  return `${r.hashPrefix}  status=${r.status}  tools=${r.toolCount}`;
}

/** Key files hold the raw key as their trimmed content. Empty files are skipped by the caller. */
export function keyFromFileContent(content: string): string {
  return content.trim();
}
