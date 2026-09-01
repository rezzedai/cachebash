/**
 * PLAN-W1 EXECUTE — the service-side backfill write path
 * (modules/dispatch/backfillExpiresAt.ts). Dry-run by default, fleet-internal
 * only, batches <=400, idempotent/resumable by doc id, never overwrites an
 * existing expiresAt or touches any other field.
 */

import { backfillTaskExpiresAtHandler } from "../modules/dispatch/backfillExpiresAt.js";
import { CONSTANTS } from "../config/constants.js";
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

/**
 * In-memory Firestore fixture. Docs mutate in place on `.update()` so a second
 * handler call against the same fixture exercises real idempotency, not a
 * fresh mock.
 */
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
        ref: {
          id,
          update: jest.fn((patch: Record<string, any>) => {
            const current = store.get(id);
            if (!current) throw new Error(`doc ${id} vanished`);
            Object.assign(current, patch);
            return Promise.resolve();
          }),
        },
      })),
      empty: pageIds.length === 0,
      size: pageIds.length,
    };
  }

  const collection = {
    orderBy: jest.fn(() => ({
      limit: jest.fn((n: number) => ({
        get: jest.fn(() => Promise.resolve(buildQuery(null, n))),
        startAfter: jest.fn((afterDoc: any) => ({
          get: jest.fn(() => Promise.resolve(buildQuery(afterDoc.id, n))),
        })),
      })),
    })),
  };

  const batchInstances: Array<{ update: jest.Mock; commit: jest.Mock }> = [];
  const db = {
    collection: jest.fn(() => collection),
    batch: jest.fn(() => {
      const pending: Array<{ ref: any; patch: any }> = [];
      const batch = {
        update: jest.fn((ref: any, patch: any) => pending.push({ ref, patch })),
        commit: jest.fn(() => {
          for (const { ref, patch } of pending) ref.update(patch);
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

const sentinelMs = new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime();
const now = Timestamp.now();

function fieldLessSentinelDoc(id: string) {
  return { id, data: { type: "sprint", status: "created" } }; // no completedAt -> sentinel branch
}
function fieldLessReapableDoc(id: string) {
  return { id, data: { type: "task", status: "done", completedAt: now } }; // -> reapable branch
}
function hasExpiresAtDoc(id: string, expiresAt: any) {
  return { id, data: { type: "task", status: "created", expiresAt } };
}

describe("PLAN-W1 EXECUTE: dispatch_backfill_task_expires_at", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a caller without a fleet-internal role or wildcard capability", async () => {
    activeDb = makeFixture([fieldLessSentinelDoc("a")]).db;
    const result = await backfillTaskExpiresAtHandler(
      baseAuth({ programId: "builder", capabilities: ["dispatch.read", "dispatch.write"] }),
      {}
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("UNAUTHORIZED");
  });

  it("dry-run (default): reports the classification split and writes nothing", async () => {
    const { db, store } = makeFixture([
      fieldLessSentinelDoc("a"),
      fieldLessReapableDoc("b"),
      hasExpiresAtDoc("c", now),
    ]);
    activeDb = db;

    const result = await backfillTaskExpiresAtHandler(baseAuth(), {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.mode).toBe("DRY-RUN");
    expect(parsed.scanned).toBe(3);
    expect(parsed.fieldLessFound).toBe(2);
    expect(parsed.split).toEqual({ reapable: 1, sentinel: 1 });
    expect(parsed.writtenCount).toBe(0);
    // Nothing was actually mutated.
    expect(store.get("a")!.expiresAt).toBeUndefined();
    expect(store.get("b")!.expiresAt).toBeUndefined();
  });

  it("execute:true writes expiresAt onto field-less docs using classifyForBackfill's branch, and ONLY that field", async () => {
    const { db, store } = makeFixture([fieldLessSentinelDoc("a"), fieldLessReapableDoc("b")]);
    activeDb = db;

    const result = await backfillTaskExpiresAtHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.mode).toBe("EXECUTE");
    expect(parsed.writtenCount).toBe(2);

    const a = store.get("a")!;
    expect(a.expiresAt.toDate().getTime()).toBe(sentinelMs);
    expect(a.type).toBe("sprint"); // untouched
    expect(a.status).toBe("created"); // untouched

    const b = store.get("b")!;
    expect(b.expiresAt).toBeDefined();
    expect(b.expiresAt.toDate().getTime()).toBeGreaterThan(now.toDate().getTime()); // completedAt + 7d grace
    expect(b.status).toBe("done"); // untouched
  });

  it("never overwrites a doc that already has expiresAt", async () => {
    const original = Timestamp.fromDate(new Date("2030-06-01T00:00:00Z"));
    const { db, store } = makeFixture([hasExpiresAtDoc("c", original)]);
    activeDb = db;

    const result = await backfillTaskExpiresAtHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.fieldLessFound).toBe(0);
    expect(parsed.writtenCount).toBe(0);
    expect(store.get("c")!.expiresAt.isEqual(original)).toBe(true);
  });

  it("is idempotent: a second execute run over the same fixture finds and writes zero", async () => {
    const { db, store } = makeFixture([fieldLessSentinelDoc("a"), fieldLessReapableDoc("b")]);
    activeDb = db;

    await backfillTaskExpiresAtHandler(baseAuth(), { execute: true });
    const second = await backfillTaskExpiresAtHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(second.content[0].text);

    expect(parsed.fieldLessFound).toBe(0);
    expect(parsed.writtenCount).toBe(0);
    expect(store.get("a")!.expiresAt.toDate().getTime()).toBe(sentinelMs);
  });

  it("respects limit to stage a rollout (a small first batch)", async () => {
    const docs = Array.from({ length: 10 }, (_, i) => fieldLessSentinelDoc(`doc-${i}`));
    const { db, store } = makeFixture(docs);
    activeDb = db;

    const result = await backfillTaskExpiresAtHandler(baseAuth(), { execute: true, limit: 3 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.writtenCount).toBe(3);
    const writtenCount = docs.filter((d) => store.get(d.id)!.expiresAt !== undefined).length;
    expect(writtenCount).toBe(3);
  });

  it("commits in batches of <=400 (Firestore's 500-write cap; PR #397 precedent)", async () => {
    const docs = Array.from({ length: 850 }, (_, i) => fieldLessSentinelDoc(`doc-${String(i).padStart(4, "0")}`));
    const { db, batchInstances } = makeFixture(docs);
    activeDb = db;

    const result = await backfillTaskExpiresAtHandler(baseAuth(), { execute: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.writtenCount).toBe(850);
    // 850 writes at <=400/batch must take at least 3 commits (400+400+50).
    expect(batchInstances.length).toBeGreaterThanOrEqual(3);
    for (const b of batchInstances) {
      expect(b.update.mock.calls.length).toBeLessThanOrEqual(400);
    }
  });
});
