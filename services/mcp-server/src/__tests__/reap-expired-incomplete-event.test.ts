/**
 * R1.4 (dispatch-defects-1-and-2, ISO-ruled additive-only): "A task lapsing
 * while incomplete is an event. Today it is indistinguishable from a task
 * that never existed." Before this fix, dispatch_reap_expired_tasks deleted
 * every expired doc silently -- whether or not the task had ever been
 * claimed, worked, or resolved. This suite proves a brand-new
 * TASK_EXPIRED_INCOMPLETE event now fires for a doc deleted while its status
 * never reached a terminal, resolved state ("done" or "failed"), and that
 * the fired event carries actual field values (task id, target, source,
 * whether it was ever claimed) -- not merely that emitEvent was called.
 *
 * Additive only, per ISO's ruling: no existing event_type is renamed or
 * repurposed, the deletion predicate (expiresAt EXISTS AND expiresAt <= now,
 * never field-less) is unchanged, and the event fires for a status that
 * already resolved (done/failed) exactly as before -- no event.
 */

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));

import { reapExpiredTasksHandler } from "../modules/dispatch/reapExpiredTasks.js";
import { emitEvent } from "../modules/events.js";
import { Timestamp } from "firebase-admin/firestore";
import type { AuthContext } from "../auth/authValidator.js";

const mockEmitEvent = emitEvent as jest.Mock;

function baseAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "test-user",
    programId: "basher",
    keyProgramId: "basher",
    apiKeyHash: "test-hash",
    capabilities: ["*"],
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    rateLimitTier: "internal",
    ...overrides,
  } as AuthContext;
}

/** In-memory Firestore fixture; deletes actually remove from `store`. */
function makeFixture(docs: Array<{ id: string; data: Record<string, any> }>) {
  const store = new Map(docs.map((d) => [d.id, { ...d.data }]));

  function buildQuery(startAfterId: string | null, limit: number) {
    const ids = [...store.keys()].sort();
    const startIdx = startAfterId ? ids.indexOf(startAfterId) + 1 : 0;
    const pageIds = ids.slice(startIdx, startIdx + limit);
    return {
      docs: pageIds.map((id) => ({
        id,
        data: () => ({ ...store.get(id) }),
        ref: { id, delete: jest.fn(() => Promise.resolve()) },
      })),
      empty: pageIds.length === 0,
      size: pageIds.length,
    };
  }

  type FakeDocRef = { id: string; delete: jest.Mock; get: jest.Mock };
  function docRef(id: string): FakeDocRef {
    const ref: FakeDocRef = {
      id,
      delete: jest.fn(() => Promise.resolve()),
      get: jest.fn(),
    };
    ref.get.mockImplementation(() =>
      Promise.resolve(
        store.has(id)
          ? { id, exists: true, ref, data: () => ({ ...store.get(id) }) }
          : { id, exists: false, ref, data: () => undefined }
      )
    );
    return ref;
  }

  const collection = {
    doc: jest.fn((id: string) => docRef(id)),
    orderBy: jest.fn(() => ({
      limit: jest.fn((n: number) => ({
        get: jest.fn(() => Promise.resolve(buildQuery(null, n))),
        startAfter: jest.fn((afterDoc: any) => ({
          get: jest.fn(() => Promise.resolve(buildQuery(afterDoc.id, n))),
        })),
      })),
    })),
  };

  const db = {
    collection: jest.fn(() => collection),
    getAll: jest.fn((...refs: Array<{ id: string }>) =>
      Promise.all(
        refs.map((ref) =>
          store.has(ref.id)
            ? { id: ref.id, exists: true, ref: docRef(ref.id), data: () => ({ ...store.get(ref.id) }) }
            : { id: ref.id, exists: false, ref: docRef(ref.id), data: () => undefined }
        )
      )
    ),
    batch: jest.fn(() => {
      const pendingIds: string[] = [];
      const batch = {
        delete: jest.fn((ref: any) => pendingIds.push(ref.id)),
        commit: jest.fn(() => {
          for (const id of pendingIds) store.delete(id);
          return Promise.resolve();
        }),
      };
      return batch;
    }),
  };

  return { db, store };
}

let activeDb: any;
jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => activeDb),
}));

const yesterday = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);

function unresolvedExpiredDoc(id: string, opts: { claimedBy?: string | null; target?: string; source?: string; status?: string } = {}) {
  return {
    id,
    data: {
      type: "task",
      status: opts.status ?? "created",
      source: opts.source ?? "iso",
      target: opts.target ?? "basher",
      claimedBy: opts.claimedBy ?? null,
      expiresAt: yesterday,
    },
  };
}
function resolvedExpiredDoc(id: string, status: "done" | "failed") {
  return { id, data: { type: "task", status, source: "iso", target: "basher", claimedBy: "basher", expiresAt: yesterday } };
}

describe("R1.4: TASK_EXPIRED_INCOMPLETE fires when the reaper deletes an unresolved task", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fires the new event when a NEVER-CLAIMED, still-'created' task is deleted", async () => {
    const { db } = makeFixture([unresolvedExpiredDoc("a", { claimedBy: null, target: "basher", source: "iso" })]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const [userId, payload] = mockEmitEvent.mock.calls[0];
    expect(userId).toBe("test-user");
    expect(payload.event_type).toBe("TASK_EXPIRED_INCOMPLETE");
    expect(payload.task_id).toBe("a");
    expect(payload.target).toBe("basher");
    expect(payload.source).toBe("iso");
    // Never claimed -- the reader must be able to tell "nobody ever picked
    // this up" apart from "claimed, then abandoned".
    expect(payload.was_claimed).toBe(false);
  });

  it("fires with was_claimed:true for a task that was claimed but never resolved (status 'active')", async () => {
    const { db } = makeFixture([unresolvedExpiredDoc("b", { status: "active", claimedBy: "basher" })]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    const [, payload] = mockEmitEvent.mock.calls[0];
    expect(payload.was_claimed).toBe(true);
  });

  it.each(["blocked", "completing"])("fires for status '%s' too -- any non-terminal status is unmet", async (status) => {
    const { db } = makeFixture([unresolvedExpiredDoc("c", { status, claimedBy: "basher" })]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent.mock.calls[0][1].task_id).toBe("c");
  });

  it.each(["done", "failed"])("does NOT fire for a task that already resolved to '%s' before expiring", async (status) => {
    const { db } = makeFixture([resolvedExpiredDoc("d", status as "done" | "failed")]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire in dry-run mode -- nothing left the system, so there is nothing to report", async () => {
    const { db } = makeFixture([unresolvedExpiredDoc("e")]);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.mode).toBe("DRY-RUN");
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire for a doc that fails the deletion predicate (field-less), execute:true notwithstanding", async () => {
    const { db } = makeFixture([{ id: "f", data: { type: "sprint", status: "created", source: "orchestrator" } }]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("fires once per unresolved doc across a mixed batch, unaffected docs produce no event", async () => {
    const { db } = makeFixture([
      unresolvedExpiredDoc("g1", { claimedBy: null }),
      unresolvedExpiredDoc("g2", { claimedBy: "iso", status: "active" }),
      resolvedExpiredDoc("g3", "done"),
      resolvedExpiredDoc("g4", "failed"),
    ]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

    expect(mockEmitEvent).toHaveBeenCalledTimes(2);
    const firedIds = mockEmitEvent.mock.calls.map((c) => c[1].task_id).sort();
    expect(firedIds).toEqual(["g1", "g2"]);
  });

  describe("manifest-driven mode (`ids`)", () => {
    it("fires the same event, with the same fields, when deleting via the ids path", async () => {
      const { db } = makeFixture([unresolvedExpiredDoc("h", { claimedBy: null, target: "sark", source: "vector" })]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), { execute: true, ids: ["h"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.manifestMode).toBe(true);
      expect(parsed.deletedCount).toBe(1);
      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
      const [, payload] = mockEmitEvent.mock.calls[0];
      expect(payload.event_type).toBe("TASK_EXPIRED_INCOMPLETE");
      expect(payload.task_id).toBe("h");
      expect(payload.target).toBe("sark");
      expect(payload.source).toBe("vector");
      expect(payload.was_claimed).toBe(false);
    });

    it("does NOT fire for an id that fails the live re-assert (rescued since the manifest was taken)", async () => {
      const nextYear = Timestamp.fromMillis(Date.now() + 365 * 24 * 3600 * 1000);
      const { db } = makeFixture([{ id: "i", data: { type: "task", status: "created", source: "iso", target: "basher", claimedBy: null, expiresAt: nextYear } }]);
      activeDb = db;

      await reapExpiredTasksHandler(baseAuth(), { execute: true, ids: ["i"] });

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it("does NOT fire in ids dry-run mode", async () => {
      const { db } = makeFixture([unresolvedExpiredDoc("j")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), { ids: ["j"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.mode).toBe("DRY-RUN");
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  // #425 review amendment: the original predicate checked only "done"/"failed"
  // (three-way, but the lifecycle has seven states) and so wrongly fired on a
  // task that completed successfully and was later archived -- a false alarm
  // on the exact population that did everything right. This table pins
  // emit/no-emit for EVERY state in lifecycle/engine.ts's LifecycleStatus, so
  // a future eighth state fails this test instead of silently joining the
  // wrong bucket.
  describe("full lifecycle-state table (all seven LifecycleStatus values)", () => {
    const cases: Array<{ status: string; shouldEmit: boolean; why: string }> = [
      { status: "created", shouldEmit: true, why: "never claimed, no completed_status ever recorded" },
      { status: "active", shouldEmit: true, why: "claimed, still in progress" },
      { status: "blocked", shouldEmit: true, why: "claimed, blocked mid-work" },
      { status: "completing", shouldEmit: true, why: "supervised mode awaiting approval -- never reached done/failed; a deliberate decision, not a fallthrough" },
      { status: "done", shouldEmit: false, why: "resolved -- completed successfully" },
      { status: "failed", shouldEmit: false, why: "resolved -- completed_status was FAILED, an outcome was recorded" },
      { status: "archived", shouldEmit: false, why: "resolved -- terminal, reachable from either done or failed (the #425 amendment's core case)" },
    ];

    it.each(cases)("status '$status' -> shouldEmit=$shouldEmit ($why)", async ({ status, shouldEmit }) => {
      const { db } = makeFixture([unresolvedExpiredDoc(`table-${status}`, { status, claimedBy: "basher" })]);
      activeDb = db;

      await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

      if (shouldEmit) {
        expect(mockEmitEvent).toHaveBeenCalledTimes(1);
        expect(mockEmitEvent.mock.calls[0][1].task_id).toBe(`table-${status}`);
      } else {
        expect(mockEmitEvent).not.toHaveBeenCalled();
      }
    });

    it("named case: a task that completed successfully (done) and was later archived does NOT fire -- the #425 regression itself", async () => {
      const { db } = makeFixture([
        { id: "done-then-archived", data: { type: "task", status: "archived", source: "iso", target: "basher", claimedBy: "basher", completed_status: "SUCCESS", expiresAt: yesterday } },
      ]);
      activeDb = db;

      await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it("named case: a task that FAILED and was later archived also does NOT fire -- archived is resolved regardless of which terminal state preceded it", async () => {
      const { db } = makeFixture([
        { id: "failed-then-archived", data: { type: "task", status: "archived", source: "iso", target: "basher", claimedBy: "basher", completed_status: "FAILED", expiresAt: yesterday } },
      ]);
      activeDb = db;

      await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 50000 });

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });
});
