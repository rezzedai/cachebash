/**
 * dispatch_01a061e4 — updateSessionHandler keys the sessions/_meta/programs
 * mirror on auth.programId (the CALLER) instead of the session's own
 * program. A privileged caller (the dispatcher, chiefly) updates every
 * program's session constantly, so the mirror ends up stamping the
 * CALLER's own registry doc with whichever session it last touched, and
 * the session's real owner never gets its heartbeat refreshed there.
 * fleet_health reads the program-registry mirror, so the owning program
 * reads permanently "stale" while it is provably alive.
 *
 * Also verifies the heartbeat-semantics fix: the mirror must gate
 * lastHeartbeat on args.lastHeartbeat, same as the session doc, instead of
 * stamping it unconditionally on every update.
 */

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));

type Write = { path: string; data: Record<string, unknown>; opts?: Record<string, unknown> };

let docStore: Record<string, Record<string, unknown>>;
let writes: Write[];

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
      add: jest.fn(async () => ({ id: "mock-history-doc" })),
      where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [], size: 0 })) })),
    })),
  };
}

let currentDb: ReturnType<typeof makeMockDb>;

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => currentDb),
  serverTimestamp: jest.fn(() => "mock-server-timestamp"),
}));

import { updateSessionHandler } from "../modules/pulse.js";
import type { AuthContext } from "../auth/authValidator.js";

const USER = "u1";

function auth(programId: string): AuthContext {
  return { userId: USER, programId, capabilities: ["*"] } as unknown as AuthContext;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function programDoc(programId: string) {
  return writes.find((w) => w.path === `tenants/${USER}/sessions/_meta/programs/${programId}`);
}

beforeEach(() => {
  docStore = {};
  writes = [];
  currentDb = makeMockDb();
});

describe("dispatch_01a061e4: program-registry mirror keying", () => {
  it("a privileged caller (dispatcher) updating another program's session stamps the SESSION OWNER's registry doc, not its own", async () => {
    const res = parse(
      (await updateSessionHandler(auth("dispatcher"), {
        sessionId: "basher-g5.recycle-check",
        status: "recycled",
        lastHeartbeat: true,
      })) as never
    );
    expect(res.success).toBe(true);

    const basherDoc = programDoc("basher");
    const dispatcherDoc = programDoc("dispatcher");

    expect(basherDoc).toBeDefined();
    expect(basherDoc!.data.currentSessionId).toBe("basher-g5.recycle-check");
    expect(basherDoc!.data.lastHeartbeat).toBe("mock-server-timestamp");

    // Core regression: the CALLER's own registry doc must not be touched at
    // all by updating someone else's session -- pre-fix it was stamped with
    // basher-g5's session id and a fresh heartbeat instead.
    expect(dispatcherDoc).toBeUndefined();
  });

  it("self-update (caller == session owner) is unaffected: the caller's own registry doc is stamped as before", async () => {
    const res = parse(
      (await updateSessionHandler(auth("iso"), {
        sessionId: "iso.boot-check",
        status: "working",
        lastHeartbeat: true,
      })) as never
    );
    expect(res.success).toBe(true);

    const isoDoc = programDoc("iso");
    expect(isoDoc).toBeDefined();
    expect(isoDoc!.data.currentSessionId).toBe("iso.boot-check");
    expect(isoDoc!.data.lastHeartbeat).toBe("mock-server-timestamp");
  });

  it("an update without lastHeartbeat:true does not manufacture a heartbeat on either document", async () => {
    const res = parse(
      (await updateSessionHandler(auth("dispatcher"), {
        sessionId: "vector.status-note",
        status: "still ruling",
        // lastHeartbeat omitted
      })) as never
    );
    expect(res.success).toBe(true);

    const sessionWrite = writes.find((w) => w.path === `tenants/${USER}/sessions/vector.status-note`);
    const vectorDoc = programDoc("vector");

    expect(sessionWrite).toBeDefined();
    expect(sessionWrite!.data.lastHeartbeat).toBeUndefined();
    expect(vectorDoc).toBeDefined();
    expect(vectorDoc!.data.lastHeartbeat).toBeUndefined();
  });
});
