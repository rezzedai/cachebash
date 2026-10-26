/**
 * squO9AGj — update_session accepts heartbeat/context-only updates (no status).
 *
 * The PostToolUse context-reporter hook sends {lastHeartbeat, contextUsedPct}
 * on every tool call. Status text must stay optional for that shape, and such
 * an update must never blank or overwrite an existing session's name,
 * currentAction, status, progress or projectName, nor create a session.
 * Emulator-free so the default `jest` config (and CI) runs it.
 */

import * as http from "http";
import type { AuthContext } from "../auth/authValidator";
import { createRestRouter } from "../transport/rest";
import { updateSessionHandler } from "../modules/pulse.js";
import { validateAuth } from "../auth/authValidator.js";

type Write = { path: string; data: Record<string, unknown>; opts?: Record<string, unknown> };

let docStore: Record<string, Record<string, unknown>>;
let writes: Write[];
let historyAdds: number;

function makeMockDb() {
  return {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => {
        const data = docStore[path];
        return data ? { exists: true, data: () => data } : { exists: false, data: () => undefined };
      }),
      set: jest.fn(async (data: Record<string, unknown>, opts?: Record<string, unknown>) => {
        writes.push({ path, data, opts });
        docStore[path] = opts?.merge ? { ...(docStore[path] || {}), ...data } : data;
      }),
      update: jest.fn(async (data: Record<string, unknown>) => {
        writes.push({ path, data });
        docStore[path] = { ...(docStore[path] || {}), ...data };
      }),
    })),
    collection: jest.fn(() => ({
      add: jest.fn(async () => {
        historyAdds++;
        return { id: "mock-history-doc" };
      }),
      where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [], size: 0 })) })),
    })),
  };
}

let currentDb: ReturnType<typeof makeMockDb>;

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => currentDb),
  serverTimestamp: jest.fn(() => "mock-server-timestamp"),
}));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((_c: string, auth: AuthContext) => auth.programId),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "mock-corr-id"),
  createAuditLogger: jest.fn(() => ({ log: jest.fn(), error: jest.fn() })),
}));
jest.mock("../auth/authValidator.js", () => ({ validateAuth: jest.fn() }));
jest.mock("../tools.js", () => ({
  TOOL_HANDLERS: { pulse_update_session: (a: unknown, b: unknown) => require("../modules/pulse.js").updateSessionHandler(a, b) },
  TOOL_DEFINITIONS: [],
}));
jest.mock("../modules/ledger.js", () => ({ logToolCall: jest.fn() }));
jest.mock("../modules/trace.js", () => ({ traceToolCall: jest.fn() }));
jest.mock("../middleware/rateLimiter.js", () => ({
  enforceRateLimit: jest.fn(() => ({ allowed: true })),
  checkAuthRateLimit: jest.fn(() => true),
}));
jest.mock("../middleware/sessionCompliance.js", () => ({
  checkSessionCompliance: jest.fn(async () => ({ allowed: true })),
  resetTransportCompliance: jest.fn(),
}));
jest.mock("../middleware/pricingEnforce.js", () => ({ checkPricing: jest.fn(async () => ({ allowed: true })) }));
jest.mock("../middleware/usage.js", () => ({ incrementUsage: jest.fn(), incrementSeatUsage: jest.fn() }));
jest.mock("../middleware/circuitBreaker.js", () => ({
  checkCircuitBreaker: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("../modules/openapi.js", () => ({ generateOpenApiSpec: jest.fn(() => ({})) }));
jest.mock("../modules/dream.js", () => ({ dreamPeekHandler: jest.fn(), dreamActivateHandler: jest.fn() }));
jest.mock("../modules/gsp.js", () => ({ gspListNamespacesHandler: jest.fn(), gspResolveHandler: jest.fn() }));

const USER = "u1";
const SID = "basher-g1.work";
const SESSION_PATH = `tenants/${USER}/sessions/${SID}`;
const PROGRAM_PATH = `tenants/${USER}/sessions/_meta/programs/basher`;

function auth(programId = "basher"): AuthContext {
  return {
    userId: USER,
    apiKeyHash: "cb_abc123",
    encryptionKey: Buffer.from("abc"),
    programId,
    keyProgramId: programId,
    capabilities: ["*"],
    rateLimitTier: "paid",
  } as unknown as AuthContext;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const EXISTING = {
  name: "building the thing",
  currentAction: "building the thing",
  status: "active",
  progress: 40,
  projectName: "grid",
  archived: false,
};

beforeEach(() => {
  docStore = {};
  writes = [];
  historyAdds = 0;
  currentDb = makeMockDb();
});

describe("update_session heartbeat/context-only", () => {
  it("(a) sets lastHeartbeat and context on an existing session, leaving name/currentAction/status/progress/projectName untouched", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };
    docStore[PROGRAM_PATH] = { currentState: "blocked" };

    const res = parse((await updateSessionHandler(auth(), { sessionId: SID, lastHeartbeat: true, contextUsedPct: 42 })) as never);

    expect(res.success).toBe(true);
    const after = docStore[SESSION_PATH];
    expect(after.lastHeartbeat).toBe("mock-server-timestamp");
    expect(after.contextUsedPct).toBe(42);
    expect(after.name).toBe(EXISTING.name);
    expect(after.currentAction).toBe(EXISTING.currentAction);
    expect(after.status).toBe(EXISTING.status);
    expect(after.progress).toBe(40);
    expect(after.projectName).toBe("grid");
    expect(after.archived).toBe(false);
    // no history row per heartbeat, and the program's blocked state is not reset to working
    expect(historyAdds).toBe(0);
    expect(docStore[PROGRAM_PATH].currentState).toBe("blocked");
    expect(docStore[PROGRAM_PATH].lastHeartbeat).toBe("mock-server-timestamp");
  });

  it("(b) on a missing session returns success:false and writes nothing", async () => {
    const res = parse((await updateSessionHandler(auth(), { sessionId: SID, lastHeartbeat: true })) as never);

    expect(res.success).toBe(false);
    expect(res.error).toContain("session not found; send status to create it");
    expect(writes).toHaveLength(0);
    expect(docStore[SESSION_PATH]).toBeUndefined();
  });

  it("(c) an empty body with no status returns the status-required error and writes nothing", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };

    const res = parse((await updateSessionHandler(auth(), { sessionId: SID })) as never);

    expect(res.success).toBe(false);
    expect(res.error).toBe("status is required unless the update is heartbeat or context only");
    expect(writes).toHaveLength(0);
  });

  it("rejects state/progress/projectName without status instead of silently ignoring them", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };

    const res = parse((await updateSessionHandler(auth(), { sessionId: SID, lastHeartbeat: true, progress: 90 })) as never);

    expect(res.success).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("keeps the C2 cross-session check ahead of any heartbeat write", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };

    const res = parse((await updateSessionHandler(auth("iso"), { sessionId: SID, lastHeartbeat: true })) as never);

    expect(res.success).toBe(false);
    expect(res.error).toContain("Cannot update another program's session");
    expect(writes).toHaveLength(0);
  });

  it("(d) a normal update with status is unchanged: overwrites name/currentAction/status/progress and appends history", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };

    const res = parse((await updateSessionHandler(auth(), { sessionId: SID, status: "reviewing", progress: 70 })) as never);

    expect(res.success).toBe(true);
    expect(res.message).toBe('Status updated: "reviewing"');
    const after = docStore[SESSION_PATH];
    expect(after.name).toBe("reviewing");
    expect(after.currentAction).toBe("reviewing");
    expect(after.status).toBe("active");
    expect(after.progress).toBe(70);
    expect(after.lastHeartbeat).toBeUndefined();
    expect(historyAdds).toBe(1);
    expect(docStore[PROGRAM_PATH].currentState).toBe("working");
  });
});

describe("REST PATCH /v1/sessions/:id heartbeat", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(createRestRouter());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("(e) {lastHeartbeat:true,contextUsedPct:N} returns 200 and updates only heartbeat/context", async () => {
    docStore[SESSION_PATH] = { ...EXISTING };
    (validateAuth as jest.Mock).mockResolvedValue(auth());

    const res = await fetch(`${baseUrl}/v1/sessions/${SID}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer cb_test", "Content-Type": "application/json" },
      body: JSON.stringify({ lastHeartbeat: true, contextUsedPct: 37 }),
    });
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(docStore[SESSION_PATH].lastHeartbeat).toBe("mock-server-timestamp");
    expect(docStore[SESSION_PATH].contextUsedPct).toBe(37);
    expect(docStore[SESSION_PATH].currentAction).toBe(EXISTING.currentAction);
  });
});
