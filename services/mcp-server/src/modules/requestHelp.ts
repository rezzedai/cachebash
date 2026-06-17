/**
 * requestHelp module — LITE-profile only.
 *
 * Server-side cross-grid egress: tenant (cerebro) asks the home grid for help
 * via the `grid-help` alias, authenticating as `rezzed.agent` (relay-only key).
 *
 * Uses the stateful MCP handshake transport — REST /v1/messages is owner-only
 * (403 PORTAL_OWNER_ONLY for a cb_ relay key; verified live by VECTOR).
 * Handshake sequence: initialize → capture Mcp-Session-Id → notifications/initialized → tools/call
 *
 * ALERT maps to DIRECTIVE at the relay layer (relay API does not accept ALERT).
 * Session is cached and re-handshaked on 401 / session-invalid.
 */
import { randomUUID } from "crypto";
import { AuthContext } from "../auth/authValidator.js";

const HOME_GRID_MCP_URL =
  process.env.HOME_GRID_MCP ?? "https://api.cachebash.dev/v1/mcp";

const LEXICON = {
  helpDrop: "I've asked my support team — they'll be in touch shortly.",
};

export interface RequestHelpArgs {
  symptom: string;
  loopId?: string;
  context?: string;
}

export interface RequestHelpResult {
  sayf: string;
  correlationId: string;
}

// Module-level session cache — reused across calls within the same process.
let _cachedSession: string | null = null;
// Injectable fetch for tests.
let _fetchFn: typeof fetch = globalThis.fetch;

/** Injectable for tests only — replaces the global fetch implementation. */
export function _setFetchFn(fn: typeof fetch) {
  _fetchFn = fn;
  _cachedSession = null; // reset session when fetch changes (test isolation)
}

async function handshake(mcpUrl: string, key: string): Promise<string> {
  const initResp = await _fetchFn(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cachebash-lite-request-help", version: "1.0" },
      },
    }),
  });

  const sid = initResp.headers.get("mcp-session-id");
  if (!sid) {
    throw new Error("[request_help] MCP initialize returned no Mcp-Session-Id");
  }

  await _fetchFn(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Mcp-Session-Id": sid,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  return sid;
}

async function sendViaHandshake(
  mcpUrl: string,
  key: string,
  args: Record<string, unknown>
): Promise<void> {
  if (!_cachedSession) {
    _cachedSession = await handshake(mcpUrl, key);
  }

  const doCall = async (sessionId: string) =>
    _fetchFn(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "relay_send_message", arguments: args },
      }),
    });

  let resp = await doCall(_cachedSession);

  if (resp.status === 401 || resp.status === 400) {
    const text = await resp.text().catch(() => "");
    if (resp.status === 401 || text.toLowerCase().includes("session")) {
      _cachedSession = await handshake(mcpUrl, key);
      resp = await doCall(_cachedSession);
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    // Fire-and-forget: log but do not throw — uplink failures must not surface to Sayf.
    console.error(`[request_help] egress ${resp.status}: ${text.slice(0, 200)}`);
  }
}

export async function requestHelpHandler(
  _auth: AuthContext,
  args: RequestHelpArgs
): Promise<RequestHelpResult> {
  const { symptom, loopId = "unknown", context = "" } = args;

  const key = process.env.REZZED_AGENT_KEY;
  if (!key) {
    // Misconfiguration — surface clearly so ops can fix; not a Sayf-visible string.
    throw new Error("[request_help] REZZED_AGENT_KEY not configured");
  }

  const tenant = process.env.CACHEBASH_TENANT_ID ?? "cerebro";
  const correlationId = randomUUID();

  const relayArgs = {
    source: "rezzed.agent",
    target: "grid-help",
    message_type: "DIRECTIVE",
    message: `[${tenant}-bridge] help-drop tenant="${tenant}" loop="${loopId}" symptom="${symptom}"`,
    payload: { source: tenant, tenant, loopId, symptom, context, msgId: correlationId },
  };

  // Fire-and-forget: errors logged server-side, not surfaced to Sayf.
  sendViaHandshake(HOME_GRID_MCP_URL, key, relayArgs).catch((err) => {
    console.error(`[request_help] egress error: ${err?.message}`);
  });

  return { sayf: LEXICON.helpDrop, correlationId };
}
