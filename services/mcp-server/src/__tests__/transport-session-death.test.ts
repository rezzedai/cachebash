/**
 * GRIDBOT false critical: SESSION_DEATH must carry the credential principal and
 * count sessions, not requests.
 */
const emitEvent = jest.fn();
jest.mock("../modules/events.js", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
const validateSession = jest.fn();
jest.mock("../transport/SessionManager.js", () => ({
  SessionManager: jest.fn().mockImplementation(() => ({
    validateSession: (...a: unknown[]) => validateSession(...a),
    createSession: jest.fn(),
    deleteSession: jest.fn(),
  })),
}));
jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn() }));

import { CustomHTTPTransport } from "../transport/CustomHTTPTransport";

const auth: any = { userId: "u1", keyProgramId: "vector", apiKeyHash: "h", capabilities: [], rateLimitTier: "free" };

function req(sessionId: string): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/foo" }),
  });
}

function make(): CustomHTTPTransport {
  const t = new CustomHTTPTransport({ responseQueueTimeout: 10, enableDnsRebindingProtection: false } as any);
  t.onmessage = () => {};
  return t;
}

describe("SESSION_DEATH telemetry", () => {
  beforeEach(() => {
    emitEvent.mockClear();
    validateSession.mockReset().mockResolvedValue({ valid: false, error: "Session not found" });
  });

  it("(a) program_id is the credential principal, not unknown", async () => {
    await make().handleRequest(req("sess-a"), auth);
    const deaths = emitEvent.mock.calls.filter((c) => c[1].event_type === "SESSION_DEATH");
    expect(deaths).toHaveLength(1);
    expect(deaths[0][1].program_id).toBe("vector");
  });

  it("(b) 3 requests with the same invalid id emit 1 event", async () => {
    const t = make();
    for (let i = 0; i < 3; i++) await t.handleRequest(req("sess-b"), auth);
    expect(emitEvent.mock.calls.filter((c) => c[1].event_type === "SESSION_DEATH")).toHaveLength(1);
  });

  it("distinct invalid ids each emit once", async () => {
    const t = make();
    await t.handleRequest(req("sess-c1"), auth);
    await t.handleRequest(req("sess-c2"), auth);
    expect(emitEvent.mock.calls.filter((c) => c[1].event_type === "SESSION_DEATH")).toHaveLength(2);
  });
});
