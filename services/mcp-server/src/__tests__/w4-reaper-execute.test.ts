/**
 * PLAN-W4 — THE REAPER (modules/dispatch/reapExpiredTasks.ts). Dry-run by
 * default, fleet-internal only, batches <=400, and W4-R1 (never delete a
 * field-less doc) is structural, not just an assertion.
 */

import { reapExpiredTasksHandler } from "../modules/dispatch/reapExpiredTasks.js";
import { Timestamp } from "firebase-admin/firestore";
import type { AuthContext } from "../auth/authValidator.js";

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

  const batchInstances: Array<{ delete: jest.Mock; commit: jest.Mock }> = [];
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
      batchInstances.push(batch);
      return batch;
    }),
  };

  return { db, store, batchInstances };
}

let activeDb: any;
jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => activeDb),
}));

const yesterday = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
const nextYear = Timestamp.fromMillis(Date.now() + 365 * 24 * 3600 * 1000);
const sentinel = Timestamp.fromDate(new Date("2099-01-01T00:00:00Z"));

function expiredDoc(id: string, source = "enrichment-worker") {
  return { id, data: { type: "task", status: "done", source, expiresAt: yesterday } };
}
function liveDoc(id: string) {
  return { id, data: { type: "task", status: "created", source: "iso", expiresAt: nextYear } };
}
function rescuedDoc(id: string) {
  return { id, data: { type: "task", status: "created", source: "iso", expiresAt: sentinel } };
}
function fieldLessDoc(id: string) {
  return { id, data: { type: "sprint", status: "created", source: "orchestrator" } };
}

describe("PLAN-W4: dispatch_reap_expired_tasks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a caller without a fleet-internal role or wildcard capability", async () => {
    activeDb = makeFixture([expiredDoc("a")]).db;
    const result = await reapExpiredTasksHandler(
      baseAuth({ programId: "builder", capabilities: ["dispatch.read", "dispatch.write"] }),
      {}
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("UNAUTHORIZED");
  });

  it("dry-run (default): reports counts and deletes nothing", async () => {
    const { db, store } = makeFixture([expiredDoc("a"), liveDoc("b"), fieldLessDoc("c")]);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.mode).toBe("DRY-RUN");
    expect(parsed.scanned).toBe(3);
    expect(parsed.fieldLessCount).toBe(1);
    expect(parsed.liveWithExpiry).toBe(1);
    expect(parsed.expiredCandidates).toBe(1);
    expect(parsed.deletedCount).toBe(0);
    expect(store.size).toBe(3); // nothing actually removed
  });

  it("W4-R1: a field-less doc is NEVER a delete candidate, even with execute:true", async () => {
    const { db, store } = makeFixture([fieldLessDoc("a"), fieldLessDoc("b")]);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.fieldLessCount).toBe(2);
    expect(parsed.expiredCandidates).toBe(0);
    expect(parsed.deletedCount).toBe(0);
    expect(store.size).toBe(2); // both still present
  });

  it("a doc with expiresAt in the future is never deleted", async () => {
    const { db, store } = makeFixture([liveDoc("a")]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true });
    expect(store.has("a")).toBe(true);
  });

  it("the 2099 never-expires sentinel is never treated as expired", async () => {
    const { db, store } = makeFixture([rescuedDoc("carry-forward-1")]);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.expiredCandidates).toBe(0);
    expect(parsed.deletedCount).toBe(0);
    expect(store.has("carry-forward-1")).toBe(true);
  });

  it("execute:true deletes only the genuinely expired docs", async () => {
    const { db, store } = makeFixture([expiredDoc("a"), liveDoc("b"), fieldLessDoc("c"), rescuedDoc("d")]);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.deletedCount).toBe(1);
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
    expect(store.has("d")).toBe(true);
  });

  it("cohortSource narrows deletion to one source, but bySource always reports the true un-narrowed breakdown", async () => {
    const docs = [
      ...Array.from({ length: 5 }, (_, i) => expiredDoc(`ew-${i}`, "enrichment-worker")),
      ...Array.from({ length: 3 }, (_, i) => expiredDoc(`sys-${i}`, "system")),
    ];
    const { db, store } = makeFixture(docs);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true, cohortSource: "enrichment-worker" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.bySource).toEqual({ "enrichment-worker": 5, system: 3 });
    expect(parsed.deletedCount).toBe(5);
    expect(store.size).toBe(3); // only the system docs remain
    for (let i = 0; i < 3; i++) expect(store.has(`sys-${i}`)).toBe(true);
  });

  it("is idempotent: a second execute run over the same fixture deletes zero more", async () => {
    const { db, store } = makeFixture([expiredDoc("a"), expiredDoc("b")]);
    activeDb = db;

    await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const second = await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(second.content[0].text);

    expect(parsed.expiredCandidates).toBe(0);
    expect(parsed.deletedCount).toBe(0);
    expect(store.size).toBe(0);
  });

  it("commits in batches of <=400 (Firestore's 500-write cap; PR #397 precedent)", async () => {
    const docs = Array.from({ length: 850 }, (_, i) => expiredDoc(`doc-${String(i).padStart(4, "0")}`));
    const { db, store, batchInstances } = makeFixture(docs);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.deletedCount).toBe(850);
    expect(store.size).toBe(0);
    expect(batchInstances.length).toBeGreaterThanOrEqual(3);
    for (const b of batchInstances) {
      expect(b.delete.mock.calls.length).toBeLessThanOrEqual(400);
    }
  });

  it("respects limit to stage a rollout", async () => {
    const docs = Array.from({ length: 10 }, (_, i) => expiredDoc(`doc-${i}`));
    const { db, store } = makeFixture(docs);
    activeDb = db;

    const result = await reapExpiredTasksHandler(baseAuth(), { execute: true, limit: 3 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.deletedCount).toBe(3);
    expect(store.size).toBe(7);
  });

  describe("manifest-driven mode (`ids`)", () => {
    it("re-asserts the live predicate and skips an id that was rescued since the manifest was taken", async () => {
      const { db, store } = makeFixture([expiredDoc("stale-a"), rescuedDoc("rescued-b")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), {
        execute: true,
        ids: ["stale-a", "rescued-b"],
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.manifestMode).toBe(true);
      expect(parsed.deletedCount).toBe(1);
      expect(parsed.deletedIds).toEqual(["stale-a"]);
      expect(parsed.skippedCount).toBe(1);
      expect(parsed.skippedIds).toEqual(["rescued-b"]);
      expect(store.has("stale-a")).toBe(false);
      expect(store.has("rescued-b")).toBe(true);
    });

    it("treats an id that no longer exists as an idempotent no-op, not an error", async () => {
      const { db, store } = makeFixture([expiredDoc("still-here")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), {
        execute: true,
        ids: ["still-here", "already-gone"],
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.notFoundCount).toBe(1);
      expect(parsed.deletedCount).toBe(1);
      expect(store.has("still-here")).toBe(false);
    });

    it("W4-R1 holds in manifest mode too: a field-less id is never deleted", async () => {
      const { db, store } = makeFixture([fieldLessDoc("no-field")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), { execute: true, ids: ["no-field"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.fieldLessCount).toBe(1);
      expect(parsed.deletedCount).toBe(0);
      expect(store.has("no-field")).toBe(true);
    });

    it("dry-run (default) reports the same classification but deletes nothing", async () => {
      const { db, store } = makeFixture([expiredDoc("a"), rescuedDoc("b")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), { ids: ["a", "b"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.mode).toBe("DRY-RUN");
      expect(parsed.deletedCount).toBe(0);
      expect(parsed.skippedCount).toBe(1);
      expect(store.size).toBe(2);
    });

    it("is idempotent: re-running the same id list after a partial delete only touches what remains", async () => {
      const { db, store } = makeFixture([expiredDoc("a"), expiredDoc("b")]);
      activeDb = db;

      const first = await reapExpiredTasksHandler(baseAuth(), { execute: true, ids: ["a"] });
      const second = await reapExpiredTasksHandler(baseAuth(), { execute: true, ids: ["a", "b"] });

      expect(JSON.parse(first.content[0].text).deletedCount).toBe(1);
      const parsedSecond = JSON.parse(second.content[0].text);
      expect(parsedSecond.notFoundCount).toBe(1); // "a" is already gone
      expect(parsedSecond.deletedCount).toBe(1); // only "b"
      expect(store.size).toBe(0);
    });

    it("ids takes priority over cohortSource/limit when both are supplied", async () => {
      const { db, store } = makeFixture([expiredDoc("a", "enrichment-worker"), expiredDoc("b", "system")]);
      activeDb = db;

      const result = await reapExpiredTasksHandler(baseAuth(), {
        execute: true,
        ids: ["b"],
        cohortSource: "enrichment-worker",
        limit: 1,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.manifestMode).toBe(true);
      expect(parsed.deletedIds).toEqual(["b"]);
      expect(store.has("a")).toBe(true);
      expect(store.has("b")).toBe(false);
    });
  });
});
