/**
 * Regression test: get_tasks `limit` must bound MATCHING rows, not raw
 * candidates (R3.2/R3.3/R3.4/R3.5/§4.1 — PDR-dispatch-layer-silent-absence
 * §Defect 3, plan grid/plans/ISO-plan-get-tasks-under-reports.md).
 *
 * Today (pre-fix): `.orderBy("createdAt","desc").limit(args.limit).get()`
 * caps the raw Firestore candidates considered, THEN requires_action /
 * auto_archived / expiresAt filter in application code on the already
 * capped page. A queue where matching rows are sparse or buried past the
 * newest `limit` candidates under-reports or reports empty even though
 * matches exist deeper in the collection.
 *
 * SCOPE: this covers the PROVEN cap mechanism only. It is explicitly NOT a
 * fix for defect 3's second, unproven mechanism (query-vs-point-read
 * divergence observed live, §0 of the plan) — pagination does nothing for
 * that, and VECTOR's ruling is that these tests alone must not be read as
 * closing defect 3. See the PR description.
 *
 * Also covers §4.1: `total` (candidate count, R3.1) is renamed to
 * `totalCandidates` so its name matches what it has always measured.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), classifyTask: jest.fn(() => "standard") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCreated: jest.fn() }));
jest.mock("../webhooks/dispatcher-notify.js", () => ({ notifyDispatcher: jest.fn() }));

type FakeDoc = {
  id: string;
  data: Record<string, unknown>;
};

let collectionDocs: FakeDoc[] = []; // newest-first, as Firestore orderBy("createdAt","desc") would return
let builtQueries: ReturnType<typeof buildQuery>[] = [];

function makeDoc(id: string, createdAtMs: number, overrides: Record<string, unknown> = {}): FakeDoc {
  return {
    id,
    data: {
      type: "task",
      title: `title-${id}`,
      action: "queue",
      priority: "normal",
      status: "created",
      source: "iso",
      target: "basher",
      requires_action: true,
      auto_archived: false,
      createdAt: { toDate: () => new Date(createdAtMs) },
      ...overrides,
    },
  };
}

function toSnapshotDoc(doc: FakeDoc) {
  return { id: doc.id, data: () => doc.data, ref: { id: doc.id }, exists: true };
}

function buildQuery() {
  let afterId: string | undefined;
  let lim = Infinity;

  const query: any = {
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    startAfter: jest.fn((cursorDoc: { id: string }) => {
      afterId = cursorDoc.id;
      return query;
    }),
    limit: jest.fn((n: number) => {
      lim = n;
      return query;
    }),
    get: jest.fn(async () => {
      let pool = collectionDocs;
      if (afterId) {
        const idx = pool.findIndex((d) => d.id === afterId);
        pool = idx >= 0 ? pool.slice(idx + 1) : pool;
      }
      const page = pool.slice(0, lim === Infinity ? pool.length : lim);
      return { docs: page.map(toSnapshotDoc) };
    }),
    count: jest.fn(() => ({
      get: jest.fn(async () => ({ data: () => ({ count: collectionDocs.length }) })),
    })),
  };
  return query;
}

const mockDb = {
  collection: jest.fn(() => {
    const q = buildQuery();
    builtQueries.push(q);
    return q;
  }),
  doc: jest.fn((path: string) => {
    const id = path.split("/").pop()!;
    const found = collectionDocs.find((d) => d.id === id);
    return {
      get: jest.fn(async () => (found ? { ...toSnapshotDoc(found), exists: true } : { exists: false })),
    };
  }),
  batch: jest.fn(() => ({ update: jest.fn(), commit: jest.fn(() => Promise.resolve()) })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

import { getTasksHandler } from "../modules/dispatch/tasks.js";
import type { AuthContext } from "../auth/authValidator.js";

function makeAuth(): AuthContext {
  return {
    userId: "u1",
    programId: "basher",
    apiKeyHash: "hash",
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    capabilities: ["*"],
    rateLimitTier: "internal",
  } as AuthContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  collectionDocs = [];
  builtQueries = [];
});

describe("get_tasks matching-rows pagination — R3.2/R3.3/R3.4/R3.5/§4.1", () => {
  it("R3.2/R3.3/R3.7: a single matching row buried past hundreds of non-matching raw candidates is still found (multi-page proof)", async () => {
    // 500 non-matching (auto_archived:true, filtered out) newest docs, then
    // ONE matching doc as the very oldest. Old behaviour (`limit` caps raw
    // candidates at args.limit, here 10) never sees past the newest 10 --
    // permanently invisible. This also forces the internal page-size loop to
    // run more than once, proven below via builtQueries[0].get call count.
    const docs: FakeDoc[] = [];
    for (let i = 0; i < 500; i++) {
      docs.push(makeDoc(`noise${i}`, 1000 - i, { auto_archived: true }));
    }
    docs.push(makeDoc("buried-match", 1, { auto_archived: false }));
    collectionDocs = docs;

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.hasTasks).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0].id).toBe("buried-match");
    // Proves the fix actually paginates the raw candidate stream rather than
    // fetching one larger-but-still-fixed page.
    expect(builtQueries[0].get.mock.calls.length).toBeGreaterThan(1);
  });

  it("R3.4: hasTasks:false is reachable only after the raw candidate stream is exhausted, never from a single short page", async () => {
    // Every one of 500 raw candidates is filtered out. The old cap-then-filter
    // code would already report count:0 after just the first `limit`-sized
    // page; this must keep scanning to genuine exhaustion before concluding
    // hasTasks:false.
    const docs: FakeDoc[] = [];
    for (let i = 0; i < 500; i++) {
      docs.push(makeDoc(`noise${i}`, 1000 - i, { auto_archived: true }));
    }
    collectionDocs = docs;

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.hasTasks).toBe(false);
    expect(parsed.count).toBe(0);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor).toBeNull();
    expect(builtQueries[0].get.mock.calls.length).toBeGreaterThan(1);
  });

  it("R3.5: raising limit is not required to see deep matches -- a fixture that broke the old max(50) ceiling now succeeds at the default limit", async () => {
    // 200 non-matching newest docs (well past the OLD hard ceiling of 50),
    // then 3 matching docs. limit stays at the schema default (10).
    const docs: FakeDoc[] = [];
    for (let i = 0; i < 200; i++) {
      docs.push(makeDoc(`noise${i}`, 1000 - i, { auto_archived: true }));
    }
    docs.push(makeDoc("m1", 3, { auto_archived: false }));
    docs.push(makeDoc("m2", 2, { auto_archived: false }));
    docs.push(makeDoc("m3", 1, { auto_archived: false }));
    collectionDocs = docs;

    const result = await getTasksHandler(makeAuth(), { status: "created", include_archived: false }); // default limit=10
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(3);
    expect(parsed.tasks.map((t: { id: string }) => t.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("DoD 2: more matching rows than the limit returns hasMore:true and a usable cursor", async () => {
    collectionDocs = Array.from({ length: 25 }, (_, i) => makeDoc(`t${25 - i}`, 25 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(true);
    expect(typeof parsed.cursor).toBe("string");
  });

  it("DoD 5: a response under its own limit is reachable only when the result is genuinely complete", async () => {
    collectionDocs = Array.from({ length: 7 }, (_, i) => makeDoc(`t${7 - i}`, 7 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(7);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor).toBeNull();
  });

  it("hasMore is exactly false on the exact-limit boundary when nothing remains beyond it (peek, not a hardcoded value)", async () => {
    collectionDocs = Array.from({ length: 10 }, (_, i) => makeDoc(`t${10 - i}`, 10 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor).toBeNull();
  });

  it("DoD 4: a limit sweep (10/25/50) over an unchanging queue returns monotonic, consistent, prefix-stable counts", async () => {
    collectionDocs = Array.from({ length: 60 }, (_, i) => makeDoc(`t${60 - i}`, 60 - i));

    const r10 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 10, status: "created" })).content[0].text as string);
    const r25 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 25, status: "created" })).content[0].text as string);
    const r50 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 50, status: "created" })).content[0].text as string);

    expect(r10.count).toBe(10);
    expect(r25.count).toBe(25);
    expect(r50.count).toBe(50);
    const ids10 = r10.tasks.map((t: { id: string }) => t.id);
    const ids25 = r25.tasks.map((t: { id: string }) => t.id);
    const ids50 = r50.tasks.map((t: { id: string }) => t.id);
    expect(ids25.slice(0, 10)).toEqual(ids10);
    expect(ids50.slice(0, 25)).toEqual(ids25);
  });

  it("absent-field regression: docs lacking requires_action/auto_archived/expiresAt are still returned across a multi-page scan", async () => {
    const docs: FakeDoc[] = [];
    for (let i = 0; i < 300; i++) {
      docs.push(makeDoc(`noise${i}`, 1000 - i, { auto_archived: true }));
    }
    // Legacy docs: field absent entirely (not merely false/true).
    for (let i = 0; i < 5; i++) {
      const d = makeDoc(`legacy${i}`, 10 - i);
      delete d.data.requires_action;
      delete d.data.auto_archived;
      docs.push(d);
    }
    collectionDocs = docs;

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", requires_action: null, include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(5);
    expect(parsed.tasks.map((t: { id: string }) => t.id).sort()).toEqual(["legacy0", "legacy1", "legacy2", "legacy3", "legacy4"]);
  });

  it("the cursor round-trips across the new pagination path: no overlap, correct continuation, eventual exhaustion", async () => {
    collectionDocs = Array.from({ length: 25 }, (_, i) => makeDoc(`t${25 - i}`, 25 - i));

    const page1 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 10, status: "created" })).content[0].text as string);
    expect(page1.hasMore).toBe(true);
    const page2 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: page1.cursor })).content[0].text as string);
    expect(page2.tasks.map((t: { id: string }) => t.id)).not.toEqual(expect.arrayContaining(page1.tasks.map((t: { id: string }) => t.id)));
    expect(page2.hasMore).toBe(true);
    const page3 = JSON.parse((await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: page2.cursor })).content[0].text as string);
    expect(page3.count).toBe(5);
    expect(page3.hasMore).toBe(false);
  });

  it("§4.1: the candidate count field is named totalCandidates, not total, and total is not present", async () => {
    collectionDocs = Array.from({ length: 12 }, (_, i) => makeDoc(`t${12 - i}`, 12 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 5, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.totalCandidates).toBe(12);
    expect(parsed.total).toBeUndefined();
  });

  it("an unknown or expired cursor is rejected explicitly, not silently restarted from page one", async () => {
    collectionDocs = Array.from({ length: 5 }, (_, i) => makeDoc(`t${5 - i}`, 5 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: "does-not-exist" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/cursor/i);
  });
});
