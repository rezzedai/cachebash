/**
 * Regression test: get_tasks must say when a result is short (R3.1).
 *
 * Defect 3 (PDR-dispatch-layer-silent-absence, §Defect 3): the response from
 * get_tasks carries no hasMore, no cursor, no total. A caller cannot tell
 * "I have seen everything" from "this is what survived" -- the two shapes
 * are byte-identical.
 *
 * SCOPE: this covers R3.1 only -- an incomplete result must SAY so. It does
 * NOT fix the cap mechanism (R3.2: today `limit` bounds candidates
 * considered in Firestore, then requires_action/auto_archived/expiresAt
 * filter client-side on the already-capped page, so `tasks.length` can be
 * under `limit` even when more matching rows exist beyond the window).
 * `hasMore`/`cursor` here are honest about the RAW CANDIDATE window, not
 * about matching rows -- see the PR description for why that is still
 * sufficient to satisfy the DoD below.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), classifyTask: jest.fn(() => "standard") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCreated: jest.fn() }));
jest.mock("../webhooks/dispatcher-notify.js", () => ({ notifyDispatcher: jest.fn() }));

type FakeDoc = {
  id: string;
  createdAtMs: number;
  data: Record<string, unknown>;
};

// In-memory Firestore stand-in. `docs` is the full, already-ordered
// (newest-first) collection. The mock query chain implements .where() as a
// no-op filter recorder (existing tests already assert on where() calls
// elsewhere; here we only need it to not crash), honors .startAfter(),
// .limit(), and .count(), and reproduces the real cap-then-filter shape:
// `.get()` returns exactly the first N (post-startAfter) raw docs, full stop
// -- filtering by requires_action/auto_archived/expiresAt happens in the
// handler itself, same as production.
let collectionDocs: FakeDoc[] = [];

function makeDoc(id: string, createdAtMs: number, overrides: Record<string, unknown> = {}): FakeDoc {
  return {
    id,
    createdAtMs,
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
  return {
    id: doc.id,
    data: () => doc.data,
    ref: { id: doc.id },
    exists: true,
  };
}

function buildQuery(startAfterId?: string) {
  let afterId = startAfterId;
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
      let pool = collectionDocs; // already newest-first
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
  collection: jest.fn(() => buildQuery()),
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
  mockDb.collection.mockImplementation(() => buildQuery());
});

describe("get_tasks completeness signal — R3.1", () => {
  it("a queue with more matching rows than the limit returns hasMore:true and a usable cursor", async () => {
    // 15 rows, newest first, limit 10 -> 5 rows beyond the window.
    collectionDocs = Array.from({ length: 15 }, (_, i) => makeDoc(`t${15 - i}`, 15 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(true);
    expect(typeof parsed.cursor).toBe("string");
    expect(parsed.cursor).not.toBeNull();
  });

  it("a genuinely complete read returns hasMore:false and a null cursor", async () => {
    // Only 7 rows exist total, well under the limit of 10 -> nothing beyond.
    collectionDocs = Array.from({ length: 7 }, (_, i) => makeDoc(`t${7 - i}`, 7 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(7);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor).toBeNull();
  });

  it("an exact-limit read (rows == limit, nothing beyond) also returns hasMore:false", async () => {
    // Guards the boundary: count()==limit must not be mistaken for "more exist".
    collectionDocs = Array.from({ length: 10 }, (_, i) => makeDoc(`t${10 - i}`, 10 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor).toBeNull();
  });

  it("the cursor round-trips: feeding it back returns the NEXT rows, not the same ones", async () => {
    collectionDocs = Array.from({ length: 25 }, (_, i) => makeDoc(`t${25 - i}`, 25 - i));

    const page1 = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed1 = JSON.parse((page1.content[0] as { text: string }).text);
    expect(parsed1.hasMore).toBe(true);
    const page1Ids = parsed1.tasks.map((t: { id: string }) => t.id);

    const page2 = await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: parsed1.cursor });
    const parsed2 = JSON.parse((page2.content[0] as { text: string }).text);
    const page2Ids = parsed2.tasks.map((t: { id: string }) => t.id);

    // No overlap between the two pages.
    expect(page2Ids.some((id: string) => page1Ids.includes(id))).toBe(false);
    // Page 2 picks up immediately where page 1 left off (t15 was the 11th-newest).
    expect(page2Ids[0]).toBe("t15");
    expect(parsed2.hasMore).toBe(true);

    const page3 = await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: parsed2.cursor });
    const parsed3 = JSON.parse((page3.content[0] as { text: string }).text);
    // 25 total, 20 consumed by pages 1-2 -> 5 remain, exhausted now.
    expect(parsed3.count).toBe(5);
    expect(parsed3.hasMore).toBe(false);
    expect(parsed3.cursor).toBeNull();
  });

  it("absent-field docs (legacy, no requires_action/auto_archived/expiresAt) still count toward hasMore", async () => {
    // Regression guard: the peek must operate on RAW candidates, not on the
    // post-filter set, so legacy docs missing these fields don't skew hasMore.
    collectionDocs = Array.from({ length: 12 }, (_, i) =>
      makeDoc(`t${12 - i}`, 12 - i, { requires_action: undefined, auto_archived: undefined })
    );

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", requires_action: null });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(true);
  });

  it("an unknown or expired cursor is rejected explicitly, not silently restarted from page one", async () => {
    collectionDocs = Array.from({ length: 5 }, (_, i) => makeDoc(`t${5 - i}`, 5 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", cursor: "does-not-exist" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/cursor/i);
  });
});
