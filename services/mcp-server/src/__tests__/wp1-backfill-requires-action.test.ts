/**
 * WP-1 — scripts/backfill-requires-action.ts wraps
 * modules/dispatch/requiresActionBackfill.ts for its scan/classify/write
 * logic (kept under src/ so it's covered by tsc and testable here without
 * violating the package's rootDir). Dry-run by default (no flags), --apply
 * required to write, batches <=500 with per-item error isolation, idempotent.
 * Exercises runRequiresActionBackfill() directly against an in-memory
 * Firestore fixture (never a real/production Firestore client).
 */

import { runRequiresActionBackfill, classifyRequiresActionForBackfill } from "../modules/dispatch/requiresActionBackfill.js";

/**
 * In-memory Firestore fixture. Docs mutate in place on `.update()` so a
 * second run against the same fixture exercises real idempotency.
 */
function makeFixture(docs: Array<{ id: string; data: Record<string, any> }>) {
  const store = new Map(docs.map((d) => [d.id, { ...d.data }]));

  function buildQuery(statusFilter: string | null, startAfterId: string | null, limit: number) {
    let ids = [...store.keys()].sort();
    if (statusFilter) ids = ids.filter((id) => store.get(id)!.status === statusFilter);
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
            if (current.__failWrite) throw new Error(`simulated write failure for ${id}`);
            Object.assign(current, patch);
            return Promise.resolve();
          }),
        },
      })),
      empty: pageIds.length === 0,
      size: pageIds.length,
    };
  }

  function collectionWithFilter(statusFilter: string | null): any {
    return {
      where: jest.fn((field: string, _op: string, value: string) => {
        if (field !== "status") throw new Error(`unexpected where field ${field}`);
        return collectionWithFilter(value);
      }),
      orderBy: jest.fn(() => ({
        limit: jest.fn((n: number) => ({
          get: jest.fn(() => Promise.resolve(buildQuery(statusFilter, null, n))),
          startAfter: jest.fn((afterDoc: any) => ({
            get: jest.fn(() => Promise.resolve(buildQuery(statusFilter, afterDoc.id, n))),
          })),
        })),
      })),
    };
  }

  const batchInstances: Array<{ update: jest.Mock; commit: jest.Mock; failWhole?: boolean }> = [];
  const db = {
    collection: jest.fn(() => collectionWithFilter(null)),
    batch: jest.fn(() => {
      const pending: Array<{ ref: any; patch: any }> = [];
      const batch: any = {
        update: jest.fn((ref: any, patch: any) => pending.push({ ref, patch })),
        commit: jest.fn(() => {
          if (batch.failWhole) {
            return Promise.reject(new Error("simulated atomic batch failure"));
          }
          for (const { ref, patch } of pending) ref.update(patch);
          return Promise.resolve();
        }),
      };
      batchInstances.push(batch);
      return batch;
    }),
  };

  return { db: db as any, store, batchInstances };
}

function userDoc(id: string, overrides: Record<string, any> = {}) {
  return { id, data: { type: "task", target: "user", status: "created", ...overrides } };
}
function programDoc(id: string, target = "iso", overrides: Record<string, any> = {}) {
  return { id, data: { type: "task", target, status: "created", ...overrides } };
}
function alreadySetDoc(id: string, requiresAction: boolean, target = "user") {
  return { id, data: { type: "task", target, status: "created", requires_action: requiresAction } };
}

describe("WP-1: classifyRequiresActionForBackfill (pure rule)", () => {
  it("target:'user' -> false", () => {
    expect(classifyRequiresActionForBackfill({ target: "user" })).toBe(false);
  });
  it("any non-'user' target -> true", () => {
    expect(classifyRequiresActionForBackfill({ target: "iso" })).toBe(true);
    expect(classifyRequiresActionForBackfill({ target: null })).toBe(true);
    expect(classifyRequiresActionForBackfill({})).toBe(true);
  });
});

describe("WP-1: backfill-requires-action.ts dry-run classification", () => {
  it("classifies a fixture set correctly and touches nothing", async () => {
    const { db, store } = makeFixture([
      userDoc("u1"), // missing field, target:user -> false
      programDoc("p1", "iso"), // missing field, non-user -> true
      alreadySetDoc("s1", true, "iso"), // already set -> left alone
      alreadySetDoc("s2", false, "user"), // already set -> left alone
    ]);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: false });

    expect(result.mode).toBe("DRY-RUN");
    expect(result.scanned).toBe(4);
    expect(result.missingFieldFound).toBe(2);
    expect(result.classifiedFalse).toBe(1);
    expect(result.classifiedTrue).toBe(1);
    expect(result.byTargetWouldUpdate).toEqual({ user: 1, iso: 1 });
    expect(result.updatedCount).toBe(0);

    // Dry-run never writes -- nothing in the store was mutated.
    expect(store.get("u1")!.requires_action).toBeUndefined();
    expect(store.get("p1")!.requires_action).toBeUndefined();
    expect(store.get("s1")!.requires_action).toBe(true);
    expect(store.get("s2")!.requires_action).toBe(false);
  });

  it("only scans status=='created' docs", async () => {
    const { db, store } = makeFixture([
      userDoc("u1"),
      { id: "done1", data: { type: "task", target: "user", status: "done" } },
    ]);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: false });

    expect(result.scanned).toBe(1); // "done1" excluded by the status=="created" query
    expect(store.get("done1")!.requires_action).toBeUndefined();
  });
});

describe("WP-1: backfill-requires-action.ts --apply write path", () => {
  it("--apply writes requires_action per classification, and ONLY that field", async () => {
    const { db, store } = makeFixture([userDoc("u1"), programDoc("p1", "iso")]);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: true });

    expect(result.mode).toBe("APPLY");
    expect(result.updatedCount).toBe(2);
    expect(store.get("u1")!.requires_action).toBe(false);
    expect(store.get("u1")!.type).toBe("task"); // untouched
    expect(store.get("p1")!.requires_action).toBe(true);
  });

  it("never overwrites a doc that already has requires_action set", async () => {
    const { db, store } = makeFixture([alreadySetDoc("s1", true, "iso")]);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: true });

    expect(result.missingFieldFound).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(store.get("s1")!.requires_action).toBe(true);
  });

  it("is idempotent: a second --apply run over the same fixture finds and writes zero", async () => {
    const { db, store } = makeFixture([userDoc("u1"), programDoc("p1")]);

    await runRequiresActionBackfill(db, "test-tenant", { apply: true });
    const second = await runRequiresActionBackfill(db, "test-tenant", { apply: true });

    expect(second.missingFieldFound).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(store.get("u1")!.requires_action).toBe(false);
    expect(store.get("p1")!.requires_action).toBe(true);
  });

  it("commits in batches of <=500", async () => {
    const docs = Array.from({ length: 1100 }, (_, i) => userDoc(`doc-${String(i).padStart(4, "0")}`));
    const { db, batchInstances } = makeFixture(docs);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: true });

    expect(result.updatedCount).toBe(1100);
    // 1100 writes at <=500/batch must take at least 3 commits (500+500+100).
    expect(batchInstances.length).toBeGreaterThanOrEqual(3);
    for (const b of batchInstances) {
      expect(b.update.mock.calls.length).toBeLessThanOrEqual(500);
    }
  });

  it("respects --limit to stage a rollout", async () => {
    const docs = Array.from({ length: 10 }, (_, i) => userDoc(`doc-${i}`));
    const { db, store } = makeFixture(docs);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: true, limit: 3 });

    expect(result.updatedCount).toBe(3);
    const writtenCount = docs.filter((d) => store.get(d.id)!.requires_action !== undefined).length;
    expect(writtenCount).toBe(3);
  });

  it("per-item error isolation: one bad doc in a batch does not abort its batch-mates", async () => {
    const docs = [userDoc("good-1"), userDoc("bad-1", { __failWrite: true }), userDoc("good-2")];
    const { db, store, batchInstances } = makeFixture(docs);

    const result = await runRequiresActionBackfill(db, "test-tenant", { apply: true });

    // The atomic batch commit for this chunk fails (bad-1's update throws),
    // so the script falls back to per-doc writes: good-1 and good-2 succeed,
    // bad-1 is caught, logged, and does not abort the others.
    expect(batchInstances[0].commit).toHaveBeenCalled();
    expect(result.updatedCount).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].id).toBe("bad-1");
    expect(store.get("good-1")!.requires_action).toBe(false);
    expect(store.get("good-2")!.requires_action).toBe(false);
    expect(store.get("bad-1")!.requires_action).toBeUndefined();
  });
});
