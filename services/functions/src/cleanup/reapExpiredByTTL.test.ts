import {
  reapPaginated,
  reapTasks,
  reapRelay,
  MAX_PAGE_SIZE,
  MAX_PAGES_PER_COLLECTION,
} from "./reapExpiredByTTL";

/**
 * Minimal fake Firestore layer — just enough of the chainable Query/Batch
 * surface reapPaginated() actually calls (.where/.orderBy/.limit/.startAfter/
 * .get, plus .batch()/.delete()/.update()/.commit()). Not a Firestore
 * emulator; a hand-rolled stand-in so the pagination/isolation/delete-vs-update
 * logic (the actual defects) is exercised without pulling in the admin SDK.
 */
interface FakeDoc {
  id: string;
  path: string;
  expiresAt: number | null | undefined;
  [key: string]: unknown;
}

function makeFakeDb(allDocs: FakeDoc[], opts: { throwOnCollectionGroup?: string } = {}) {
  const committed: Array<{ op: "delete" | "update"; path: string; data?: unknown }> = [];

  class FakeQuery {
    constructor(
      private docs: FakeDoc[],
      private cursor: FakeDoc | null = null,
      private lim: number | null = null
    ) {}
    where(field: string, op: string, value: unknown): FakeQuery {
      const filtered = this.docs.filter((d) => {
        if (field === "expiresAt" && op === "<") {
          return d.expiresAt != null && d.expiresAt < (value as number);
        }
        if (op === "==") return (d as Record<string, unknown>)[field] === value;
        if (op === "!=") return (d as Record<string, unknown>)[field] !== value;
        throw new Error(`FakeQuery: unsupported op ${op}`);
      });
      return new FakeQuery(filtered, this.cursor, this.lim);
    }
    orderBy(field: string): FakeQuery {
      const sorted = [...this.docs].sort(
        (a, b) => ((a as any)[field] ?? 0) - ((b as any)[field] ?? 0)
      );
      return new FakeQuery(sorted, this.cursor, this.lim);
    }
    limit(n: number): FakeQuery {
      return new FakeQuery(this.docs, this.cursor, n);
    }
    startAfter(cursorDoc: FakeDoc): FakeQuery {
      const idx = this.docs.findIndex((d) => d.id === cursorDoc.id);
      return new FakeQuery(this.docs.slice(idx + 1), cursorDoc, this.lim);
    }
    async get() {
      const page = this.lim != null ? this.docs.slice(0, this.lim) : this.docs;
      return {
        empty: page.length === 0,
        size: page.length,
        docs: page.map((d) => ({
          id: d.id,
          ref: { path: d.path, id: d.id },
          // `_forceFieldless` lets a test simulate the defensive check's
          // target scenario (the where-filter's guarantee somehow not
          // holding, e.g. index/replication inconsistency) without also
          // having to bypass the filter itself, which would just make the
          // doc vanish from the page before reaching the check at all.
          get: (f: string) => (f === "expiresAt" && (d as any)._forceFieldless ? null : (d as any)[f]),
          data: () => d,
        })),
      };
    }
  }

  class FakeBatch {
    delete(ref: { path: string }) {
      committed.push({ op: "delete", path: ref.path });
    }
    update(ref: { path: string }, data: unknown) {
      committed.push({ op: "update", path: ref.path, data });
    }
    async commit() {
      /* no-op — writes already recorded above */
    }
  }

  return {
    committed,
    db: {
      collectionGroup(name: string) {
        if (opts.throwOnCollectionGroup === name) {
          throw new Error(`9 FAILED_PRECONDITION: The query requires an index (${name})`);
        }
        return new FakeQuery(allDocs.filter((d) => d.path.includes(`/${name}/`)));
      },
      batch() {
        return new FakeBatch();
      },
    } as unknown as FirebaseFirestore.Firestore,
  };
}

function fakeDoc(id: string, expiresAt: number | null): FakeDoc {
  return { id, path: `tenants/t1/tasks/${id}`, expiresAt, status: "created" };
}

describe("reapPaginated — pagination and throughput (D4)", () => {
  it("pages until a partial page signals drained, without hitting MAX_PAGES", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => fakeDoc(`d${i}`, i));
    const { db, committed } = makeFakeDb(docs);
    const result = await reapPaginated(
      db as any,
      "tasks",
      1000 as any,
      (q) => q,
      (batch, doc) => batch.delete((doc as any).ref),
      "tasks"
    );
    expect(result.reaped).toBe(5);
    expect(result.pages).toBe(1); // one page (5 < MAX_PAGE_SIZE) is enough to see it's drained
    expect(committed).toHaveLength(5);
  });

  it("caps at MAX_PAGES_PER_COLLECTION even when more docs remain", async () => {
    const totalAvailable = MAX_PAGE_SIZE * (MAX_PAGES_PER_COLLECTION + 3); // deliberately more than the cap can drain
    const docs = Array.from({ length: totalAvailable }, (_, i) => fakeDoc(`d${i}`, i));
    const { db } = makeFakeDb(docs);
    const result = await reapPaginated(
      db as any,
      "tasks",
      1_000_000 as any,
      (q) => q,
      (batch, doc) => batch.delete((doc as any).ref),
      "tasks"
    );
    expect(result.pages).toBe(MAX_PAGES_PER_COLLECTION);
    expect(result.reaped).toBe(MAX_PAGE_SIZE * MAX_PAGES_PER_COLLECTION);
  });
});

describe("reapPaginated — W4-R1 field-less defense in depth", () => {
  it("skips a doc that passes the query filter but reports field-less on read (index/replication inconsistency)", async () => {
    const docs = [
      fakeDoc("good", 5),
      // Passes the `expiresAt < now` filter (numeric value present), but its
      // .get("expiresAt") reports null — simulating the filter's guarantee
      // not holding. The defensive check inside reapPaginated must catch this.
      { id: "inconsistent", path: "tenants/t1/tasks/inconsistent", expiresAt: 7, _forceFieldless: true },
    ];
    const { db, committed } = makeFakeDb(docs as FakeDoc[]);
    const result = await reapPaginated(
      db as any,
      "tasks",
      1000 as any,
      (q) => q,
      (batch, doc) => batch.delete((doc as any).ref),
      "tasks"
    );
    expect(result.reaped).toBe(1);
    expect(committed.map((c) => c.path)).toEqual(["tenants/t1/tasks/good"]);
  });
});

describe("reapTasks — D2: deletes, never updates", () => {
  it("issues delete ops for expired tasks, not status updates", async () => {
    const docs = [fakeDoc("t1", 5), fakeDoc("t2", 10)];
    const { db, committed } = makeFakeDb(docs);
    const result = await reapTasks(db as any, 1000 as any);
    expect(result.reaped).toBe(2);
    expect(committed.every((c) => c.op === "delete")).toBe(true);
  });

  it("P1 regression: deletes an expired status=done task -- status!=done previously excluded it entirely", async () => {
    const doneDoc: FakeDoc = { id: "done1", path: "tenants/t1/tasks/done1", expiresAt: 5, status: "done" };
    const { db, committed } = makeFakeDb([doneDoc]);
    const result = await reapTasks(db as any, 1000 as any);
    expect(result.reaped).toBe(1);
    expect(committed).toEqual([{ op: "delete", path: "tenants/t1/tasks/done1" }]);
  });

  it("deletes a mix of done and non-done expired tasks -- expiry alone decides, status plays no role", async () => {
    const docs: FakeDoc[] = [
      { id: "done1", path: "tenants/t1/tasks/done1", expiresAt: 3, status: "done" },
      { id: "created1", path: "tenants/t1/tasks/created1", expiresAt: 5, status: "created" },
      { id: "cancelled1", path: "tenants/t1/tasks/cancelled1", expiresAt: 7, status: "cancelled" },
    ];
    const { db, committed } = makeFakeDb(docs);
    const result = await reapTasks(db as any, 1000 as any);
    expect(result.reaped).toBe(3);
    expect(committed.map((c) => c.path).sort()).toEqual([
      "tenants/t1/tasks/cancelled1",
      "tenants/t1/tasks/created1",
      "tenants/t1/tasks/done1",
    ]);
  });
});

describe("D3 — one collection's failure never propagates to another", () => {
  it("reapTasks catches its own error and returns a result instead of throwing", async () => {
    const { db } = makeFakeDb([], { throwOnCollectionGroup: "tasks" });
    const result = await reapTasks(db as any, 1000 as any);
    expect(result.reaped).toBe(0);
    expect(result.error).toContain("FAILED_PRECONDITION");
  });

  it("reapRelay succeeds independently when tasks' collectionGroup throws", async () => {
    const relayDocs: FakeDoc[] = [
      { id: "r1", path: "tenants/t1/relay/r1", expiresAt: 5, status: "pending" },
    ];
    const { db, committed } = makeFakeDb(relayDocs, { throwOnCollectionGroup: "tasks" });
    const tasksResult = await reapTasks(db as any, 1000 as any);
    const relayResult = await reapRelay(db as any, 1000 as any);
    expect(tasksResult.error).toBeDefined();
    expect(relayResult.error).toBeUndefined();
    expect(relayResult.reaped).toBe(1);
    expect(committed).toEqual([{ op: "update", path: "tenants/t1/relay/r1", data: expect.objectContaining({ status: "expired" }) }]);
  });
});
