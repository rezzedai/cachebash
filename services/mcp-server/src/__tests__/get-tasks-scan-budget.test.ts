/**
 * Regression test: get_tasks exhaustion scan must be BOUNDED (R3.6).
 *
 * R3.2 (efd48f0.. -> 0d7f3b8, #392) made `hasTasks:false` reachable only
 * through genuine exhaustion of the raw candidate stream (R3.4) -- correct,
 * and the point. But the loop it introduced has no page budget and no
 * timeout, and the population that forces a full scan (auto_archived:true
 * relay mirrors, expired-TTL carry-forwards) grows monotonically and is
 * never deleted. Proving "no work" -- the fleet's most frequent call --
 * therefore gets slower every day, unbounded.
 *
 * FIX: bound the scan by Firestore round-trips (MAX_CANDIDATE_PAGES). When
 * the budget is hit, the response says so honestly: hasMore:true (NEVER
 * false -- a budget cutoff reporting exhaustion would be defect 3 again,
 * wearing a fix's label) plus degraded:true/degradedReason, distinguishing
 * "budget hit, unknown how much more" from a genuine "found `limit` matches,
 * confirmed more exist" hasMore:true.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), classifyTask: jest.fn(() => "standard") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCreated: jest.fn() }));
jest.mock("../webhooks/dispatcher-notify.js", () => ({ notifyDispatcher: jest.fn() }));

type FakeDoc = { id: string; data: Record<string, unknown> };

let collectionDocs: FakeDoc[] = [];
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

function noiseRun(count: number, startAtMs: number): FakeDoc[] {
  // Non-matching (auto_archived:true) docs, mirroring relay.ts's
  // never-deleted mirror population that forces the pathological scan.
  return Array.from({ length: count }, (_, i) => makeDoc(`noise${startAtMs - i}`, startAtMs - i, { auto_archived: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  collectionDocs = [];
  builtQueries = [];
});

describe("get_tasks scan budget — R3.6", () => {
  it("the one-sided guarantee still rules: a budget cutoff sets hasMore:true, NEVER false, and marks degraded:true", async () => {
    // 5000 non-matching raw candidates, nothing else. Large enough to
    // guarantee the budget (whatever it is tuned to) is hit before the raw
    // stream is exhausted.
    collectionDocs = noiseRun(5000, 6000);

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.hasMore).toBe(true);
    expect(parsed.degraded).toBe(true);
    expect(typeof parsed.degradedReason).toBe("string");
    expect(parsed.degradedReason.length).toBeGreaterThan(0);
    expect(typeof parsed.cursor).toBe("string");
    // hasTasks:false must NEVER be asserted off a budget cutoff -- it found
    // zero matches so far, but that is not the same claim as "verified none".
    expect(parsed.count).toBe(0);
  });

  it("bounds the number of Firestore round trips regardless of collection size", async () => {
    collectionDocs = noiseRun(50000, 60000); // far larger than any reasonable budget

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.degraded).toBe(true);
    // The whole point of R3.6: this must NOT scale with collection size.
    expect(builtQueries[0].get.mock.calls.length).toBeLessThanOrEqual(15);
    expect(builtQueries[0].get.mock.calls.length).toBeGreaterThan(1);
  });

  it("a fixture that genuinely exhausts WITHIN budget still returns hasMore:false, degraded:false (both directions, explicitly)", async () => {
    // Modest fixture, comfortably inside any reasonable per-call budget.
    collectionDocs = noiseRun(500, 600);

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.hasTasks).toBe(false);
    expect(parsed.count).toBe(0);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.degraded).toBe(false);
    expect(parsed.degradedReason).toBeNull();
    expect(parsed.cursor).toBeNull();
  });

  it("a small, ordinary read (well under budget, well under limit) is NOT marked degraded", async () => {
    collectionDocs = Array.from({ length: 7 }, (_, i) => makeDoc(`t${7 - i}`, 7 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(7);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.degraded).toBe(false);
    expect(parsed.degradedReason).toBeNull();
  });

  it("matching rows beyond the budget: a budget-cut response returns hasMore:true + a working cursor, and paginating with it eventually reaches them", async () => {
    // A large non-matching prefix that spans several budget-bounded calls,
    // then real matches at the very tail (oldest).
    const prefix = noiseRun(4500, 5000);
    const matches = [
      makeDoc("m1", 3, {}),
      makeDoc("m2", 2, {}),
      makeDoc("m3", 1, {}),
    ];
    collectionDocs = [...prefix, ...matches];

    let cursor: string | undefined;
    let found: string[] = [];
    let hops = 0;
    for (;;) {
      hops++;
      if (hops > 20) throw new Error("did not converge -- pagination is not making progress");
      const r = JSON.parse(
        (await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false, cursor })).content[0].text as string
      );
      found = found.concat(r.tasks.map((t: { id: string }) => t.id));
      if (!r.hasMore) break;
      expect(typeof r.cursor).toBe("string");
      cursor = r.cursor;
    }

    expect(found.sort()).toEqual(["m1", "m2", "m3"]);
    expect(hops).toBeGreaterThan(1); // proves it actually took more than one budgeted call
  });

  it("preserves R3.2's matched-limit hasMore semantics: reaching `limit` matches within budget is NOT marked degraded", async () => {
    collectionDocs = Array.from({ length: 25 }, (_, i) => makeDoc(`t${25 - i}`, 25 - i));

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.count).toBe(10);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.degraded).toBe(false); // confirmed via peek, not a budget guess
    expect(parsed.degradedReason).toBeNull();
  });

  it("R3.4 review finding: zero matches inside the budget plus a real match beyond it must not read as idle", async () => {
    // Exactly the shape flagged in review: the raw candidates within the
    // budget are entirely non-matching (the auto_archived-mirror population
    // this budget exists to bound), and the one real match sits just past
    // the cutoff. hasTasks must not be false here -- that would be
    // indistinguishable from a genuinely verified-empty read (R3.4), and a
    // caller following CLAUDE.md's boot protocol ("no work -> report idle")
    // would falsely report idle with real work sitting past the cutoff.
    const prefix = noiseRun(2200, 3000); // comfortably past the budget boundary
    const realMatch = makeDoc("real-match", 1);
    collectionDocs = [...prefix, realMatch];

    const result = await getTasksHandler(makeAuth(), { limit: 10, status: "created", include_archived: false });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.degraded).toBe(true);
    expect(parsed.count).toBe(0);
    expect(parsed.hasTasks).not.toBe(false);
  });
});
