/**
 * Pulse State Expiry Tests — Wave B item B3
 *
 * Fleet state was sticky forever: list_sessions returned whatever a session
 * last self-declared ("working" observed at 364414s stale) and fleet-health
 * let programs with NO heartbeat at all keep their self-declared state.
 *
 * Verifies state is derived from heartbeat/lastUpdate age at read time:
 *   1. list_sessions: active session with old lastUpdate → effectiveState "stale"
 *   2. list_sessions: fresh active session → effectiveState "active"
 *   3. list_sessions: completed session never reads stale
 *   4. fleet-health: program with NO lastHeartbeat → "stale", lastReportedState kept
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

type Doc = { id: string; data: () => Record<string, unknown> };
let sessionDocs: Doc[] = [];
let programDocs: Doc[] = [];

function chainable(docs: () => Doc[]) {
  const q: Record<string, unknown> = {};
  q.where = jest.fn(() => q);
  q.orderBy = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.get = jest.fn(async () => ({ docs: docs(), size: docs().length }));
  return q;
}

const mockDb = {
  collection: jest.fn((path: string) => {
    if (path.includes("/sessions/_meta/programs")) return chainable(() => programDocs);
    if (path.endsWith("/sessions")) return chainable(() => sessionDocs);
    return chainable(() => []);
  }),
  doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-server-timestamp"),
}));

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));

import { listSessionsHandler, getFleetHealthHandler } from "../modules/pulse.js";
import type { AuthContext } from "../auth/authValidator.js";

const AUTH = { userId: "u1", programId: "basher", capabilities: ["*"] } as unknown as AuthContext;

const ts = (ageSeconds: number) => {
  const d = new Date(Date.now() - ageSeconds * 1000);
  return { toDate: () => d };
};

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  sessionDocs = [];
  programDocs = [];
});

describe("B3: list_sessions effective state", () => {
  it("active session with 4-day-old lastUpdate reads stale, raw state preserved", async () => {
    sessionDocs = [
      { id: "vector", data: () => ({ programId: "vector", status: "active", lastUpdate: ts(364414), archived: false }) },
    ];
    const res = parse((await listSessionsHandler(AUTH, {})) as never);
    expect(res.success).toBe(true);
    expect(res.sessions[0].state).toBe("active");
    expect(res.sessions[0].effectiveState).toBe("stale");
    expect(res.sessions[0].lastUpdateAgeSeconds).toBeGreaterThan(364000);
  });

  it("fresh active session reads active", async () => {
    sessionDocs = [
      { id: "basher", data: () => ({ programId: "basher", status: "active", lastUpdate: ts(60), archived: false }) },
    ];
    const res = parse((await listSessionsHandler(AUTH, {})) as never);
    expect(res.sessions[0].effectiveState).toBe("active");
  });

  it("completed session never reads stale regardless of age", async () => {
    sessionDocs = [
      { id: "old", data: () => ({ programId: "old", status: "done", lastUpdate: ts(900000), archived: false }) },
    ];
    const res = parse((await listSessionsHandler(AUTH, {})) as never);
    expect(res.sessions[0].effectiveState).toBe("done");
  });

  it("active session with NO lastUpdate reads stale (no data is not liveness)", async () => {
    sessionDocs = [
      { id: "ghost", data: () => ({ programId: "ghost", status: "active", archived: false }) },
    ];
    const res = parse((await listSessionsHandler(AUTH, {})) as never);
    expect(res.sessions[0].effectiveState).toBe("stale");
    expect(res.sessions[0].lastUpdateAgeSeconds).toBeNull();
  });
});

describe("B3: fleet-health program state", () => {
  it("program with NO heartbeat reads stale with lastReportedState preserved", async () => {
    programDocs = [
      { id: "vector", data: () => ({ currentState: "working" }) },
    ];
    const res = parse((await getFleetHealthHandler(AUTH, {})) as never);
    const prog = res.programs.find((p: { programId: string }) => p.programId === "vector");
    expect(prog.state).toBe("stale");
    expect(prog.lastReportedState).toBe("working");
    expect(res.summary.stale).toBe(1);
    expect(res.summary.working).toBe(0);
  });

  it("program with fresh heartbeat keeps its reported state", async () => {
    programDocs = [
      { id: "basher", data: () => ({ currentState: "working", lastHeartbeat: ts(120) }) },
    ];
    const res = parse((await getFleetHealthHandler(AUTH, {})) as never);
    const prog = res.programs.find((p: { programId: string }) => p.programId === "basher");
    expect(prog.state).toBe("working");
    expect(prog.heartbeatAgeSeconds).toBeGreaterThanOrEqual(115);
  });
});
