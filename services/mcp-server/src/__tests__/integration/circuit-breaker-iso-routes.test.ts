/**
 * Integration Test: WS-3 Boundary Circuit Breaker — ISO MCP transport
 *
 * SARK re-panel finding (round 2, PR #383): the ISO admin MCP endpoint
 * (POST /v1/iso/mcp, handled in iso/isoServer.ts) enforced NEITHER the
 * capability gate NOR the circuit breaker — its CallToolRequestSchema
 * handler ran a legacy checkRateLimit and then dispatched
 * ISO_TOOL_HANDLERS[name] directly. Any valid Bearer key reached mutating
 * tools (relay_send_message, dispatch_create_task, dispatch_claim_task,
 * dispatch_complete_task, signal_send_alert, pulse_update_session) with no
 * capability check and no ceiling — the third transport bypass, after the
 * main MCP transport (index.ts) and REST transport (rest.ts) were already
 * fixed.
 *
 * This proves the fix end-to-end against the real Firestore emulator and
 * the real ISO transport handler (not a mocked breaker/capability check):
 * (a) a key without the required capability is denied before the handler
 *     ever runs, and (b) the N+1th mutation in the window is denied by the
 *     breaker, with the true fail-closed (no ceilings doc) path also
 *     covered. See circuit-breaker.test.ts for the dedicated unit coverage
 *     of checkCircuitBreaker's window math, and
 *     circuit-breaker-rest-routes.test.ts for the equivalent REST-transport
 *     fix.
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData } from "./setup";
import type { AuthContext } from "../../auth/authValidator";

// Point the module under test at the emulator-backed Firestore instance
// instead of the production firebase/client.ts singleton.
jest.mock("../../firebase/client.js", () => ({
  getFirestore: () => getTestFirestoreLazy(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}));

function getTestFirestoreLazy(): admin.firestore.Firestore {
  return getTestFirestore();
}

// checkCircuitBreaker fires a signal alert on every denial as a deliberate
// fire-and-forget (see circuitBreaker.ts emitBreakerAlert) — stub it out,
// same as circuit-breaker-rest-routes.test.ts.
jest.mock("../../modules/signal.js", () => ({
  sendAlertHandler: jest.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
}));

// Legacy per-tool rate limiter is orthogonal to this fix — always allow so
// it can't mask the capability/breaker assertions below.
jest.mock("../../middleware/rateLimiter.js", () => ({
  checkRateLimit: jest.fn(() => true),
  getRateLimitResetIn: jest.fn(() => 0),
}));

// Real MCP SDK Server is a full protocol implementation we don't need here —
// mock it just enough to capture the CallToolRequestSchema handler that
// isoServer.ts registers, same technique as iso-tool-registry.test.ts.
jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: Symbol("CallToolRequestSchema"),
  ListToolsRequestSchema: Symbol("ListToolsRequestSchema"),
}));

// Stateless per-request auth transport — mock so the test can set
// `currentAuth` directly, exactly like production's per-request
// `transport.currentAuth = authContext` assignment in CustomHTTPTransport.
jest.mock("../../transport/CustomHTTPTransport.js", () => ({
  CustomHTTPTransport: jest.fn().mockImplementation(() => ({
    handleRequest: jest.fn(),
    currentAuth: null,
  })),
}));

// Tool handler modules — mocked so this test observes ONLY whether the gate
// let the call through, not the handlers' own business logic.
jest.mock("../../modules/dispatch/index.js", () => ({
  getTasksHandler: jest.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
  createTaskHandler: jest.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
  claimTaskHandler: jest.fn(),
  completeTaskHandler: jest.fn(),
}));

jest.mock("../../modules/relay.js", () => ({
  getMessagesHandler: jest.fn(),
  sendMessageHandler: jest.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
  getDeadLettersHandler: jest.fn(),
  getSentMessagesHandler: jest.fn(),
  queryMessageHistoryHandler: jest.fn(),
}));

jest.mock("../../modules/pulse.js", () => ({
  updateSessionHandler: jest.fn(),
  getFleetHealthHandler: jest.fn(),
}));

jest.mock("../../modules/keys.js", () => ({
  listKeysHandler: jest.fn(),
}));

jest.mock("../../modules/audit.js", () => ({
  getAuditHandler: jest.fn(),
}));

jest.mock("../../modules/metrics.js", () => ({
  getCostSummaryHandler: jest.fn(),
  getCommsMetricsHandler: jest.fn(),
  getOperationalMetricsHandler: jest.fn(),
}));

jest.mock("../../modules/sprint.js", () => ({
  getSprintHandler: jest.fn(),
}));

jest.mock("../../modules/ledger.js", () => ({
  logToolCall: jest.fn(),
}));

jest.mock("../../modules/trace.js", () => ({
  traceToolCall: jest.fn(),
  queryTracesHandler: jest.fn(),
}));

import { resetCircuitBreakerState } from "../../middleware/circuitBreaker";
import { createTaskHandler } from "../../modules/dispatch/index.js";
import { sendMessageHandler } from "../../modules/relay.js";

describe("WS-3 ISO transport enforcement — POST /v1/iso/mcp CallToolRequestSchema", () => {
  let db: admin.firestore.Firestore;
  const userId = "test-org-breaker-iso";

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    resetCircuitBreakerState();
    jest.clearAllMocks();
    (createTaskHandler as jest.Mock).mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    (sendMessageHandler as jest.Mock).mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  function auth(overrides: Partial<AuthContext> = {}): AuthContext {
    return {
      userId,
      apiKeyHash: "iso-test-key-hash",
      encryptionKey: Buffer.from("0123456789abcdef0123456789abcdef"),
      programId: "wingman" as any,
      capabilities: ["dispatch.read", "dispatch.write", "relay.read", "relay.write"],
      rateLimitTier: "free",
      ...overrides,
    };
  }

  async function setCeilings(overrides: Record<string, unknown>): Promise<void> {
    await db.doc(`tenants/${userId}/_meta/ceilings`).set({
      perKeyLimit: 3,
      orgLimit: 10,
      windowMs: 60_000,
      paused: false,
      ...overrides,
    });
  }

  /** Boots isoServer.ts and returns its captured CallToolRequestSchema handler + the mocked transport instance. */
  async function bootIsoCallToolHandler(): Promise<{
    callTool: (request: { params: { name: string; arguments: unknown } }, extra?: unknown) => Promise<any>;
    transport: { currentAuth: AuthContext | null };
  }> {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const { createIsoServer } = await import("../../iso/isoServer.js");

    const { transport } = await createIsoServer();

    const serverMock = Server as unknown as jest.Mock;
    const instance = serverMock.mock.results[serverMock.mock.results.length - 1].value;
    const registration = instance.setRequestHandler.mock.calls.find(
      (call: unknown[]) => call[0] === CallToolRequestSchema
    );
    if (!registration) throw new Error("isoServer.ts did not register a CallToolRequestSchema handler");

    return { callTool: registration[1], transport: transport as any };
  }

  it("denies a key without the required capability before the handler runs", async () => {
    await setCeilings({ perKeyLimit: 100, orgLimit: 100 });
    const { callTool, transport } = await bootIsoCallToolHandler();

    // Key has dispatch.* but NOT relay.write — relay_send_message must be denied.
    transport.currentAuth = auth({ capabilities: ["dispatch.read", "dispatch.write"] });

    const result = await callTool({
      params: { name: "relay_send_message", arguments: { target: "iso", message_type: "STATUS", message: "hi" } },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient capability");
    expect(result.content[0].text).toContain("relay.write");
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("allows a key with the required capability through to the handler", async () => {
    await setCeilings({ perKeyLimit: 100, orgLimit: 100 });
    const { callTool, transport } = await bootIsoCallToolHandler();

    transport.currentAuth = auth();

    const result = await callTool({
      params: { name: "relay_send_message", arguments: { target: "iso", message_type: "STATUS", message: "hi" } },
    });

    expect(result.isError).toBeFalsy();
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });

  it("the N+1th mutating call in the window is denied by the breaker before the handler runs", async () => {
    await setCeilings({ perKeyLimit: 1, orgLimit: 100 });
    const { callTool, transport } = await bootIsoCallToolHandler();
    transport.currentAuth = auth();

    const first = await callTool({ params: { name: "dispatch_create_task", arguments: { title: "t1", target: "basher" } } });
    expect(first.isError).toBeFalsy();
    expect(createTaskHandler).toHaveBeenCalledTimes(1);

    // 2nd call (N+1th): the breaker must deny it BEFORE ISO_TOOL_HANDLERS
    // dispatches to createTaskHandler — this is exactly the bypass the SARK
    // re-panel flagged.
    const second = await callTool({ params: { name: "dispatch_create_task", arguments: { title: "t2", target: "basher" } } });
    expect(second.isError).toBe(true);
    const body = JSON.parse(second.content[0].text);
    expect(body.error).toBe("CEILING_KEY_EXCEEDED");
    expect(createTaskHandler).toHaveBeenCalledTimes(1);

    // Reads are unaffected by the tripped mutation ceiling.
    const read = await callTool({ params: { name: "dispatch_get_tasks", arguments: {} } });
    expect(read.isError).toBeFalsy();
  });

  it("fails closed: denies mutating calls but allows reads when the tenant has no ceilings doc", async () => {
    // No setCeilings() call — tenant has no _meta/ceilings doc at all.
    const { callTool, transport } = await bootIsoCallToolHandler();
    transport.currentAuth = auth();

    const mutation = await callTool({ params: { name: "dispatch_create_task", arguments: { title: "t1", target: "basher" } } });
    expect(mutation.isError).toBe(true);
    const body = JSON.parse(mutation.content[0].text);
    expect(body.error).toBe("CEILING_CONFIG_UNAVAILABLE");
    expect(createTaskHandler).not.toHaveBeenCalled();

    const read = await callTool({ params: { name: "dispatch_get_tasks", arguments: {} } });
    expect(read.isError).toBeFalsy();
  });
});
