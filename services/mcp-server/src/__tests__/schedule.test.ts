/**
 * schedule.ts — failed-query fallback regression
 * (ISO-plan-failed-query-must-not-look-empty.md, grid commit 40fa653d).
 *
 * A filtered query with no backing composite index must return the correct
 * rows, marked as degraded -- never an error, never a silent empty/partial
 * set. The collection used here is deliberately larger than one page (the
 * public `limit` caps at 50) to prove the fallback paginates to exhaustion
 * rather than filtering a single capped page.
 */
import type { AuthContext } from "../auth/authValidator";
import { listSchedulesHandler } from "../modules/schedule";
// tools/index.ts's barrel transitively imports an ESM-only dependency
// (@octokit/rest via dispatch/github-sync) that this project's ts-jest CJS
// config cannot parse -- tools/schedule.ts is the same registration this
// module contributes to that barrel, without the incompatible import chain.
import { handlers as scheduleToolHandlers } from "../tools/schedule";

// ── In-memory Firestore mock with FAILED_PRECONDITION injection + cursor pagination ──

let mockDocs: Record<string, any> = {};
/** When set, any query carrying a `where()` clause throws this on .get(). */
let failFilteredQueries: boolean = false;
/** When set, overrides the thrown error's .code for filtered queries (default 9/FAILED_PRECONDITION). */
let failCode: number = 9;

function seedDoc(path: string, data: any) {
  mockDocs[path] = { ...data };
}

function parse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// Immutable, like the real Firestore Query -- each where/orderBy/limit/
// startAfter returns a NEW query carrying the accumulated state, never
// mutates a shared chain. A mutating mock previously leaked `hasWhere` from
// an earlier filtered query into the fallback's later unfiltered one.
type QueryState = {
  filters: Array<(data: any) => boolean>;
  hasWhere: boolean;
  orderByField: string | null;
  orderDir: "asc" | "desc";
  limitN: number | null;
  startAfterDoc: any;
};

function buildQuery(colPath: string, state: QueryState) {
  const prefix = colPath.endsWith("/") ? colPath : colPath + "/";

  const next = (patch: Partial<QueryState>) => buildQuery(colPath, { ...state, ...patch });

  return {
    where(field: string, op: string, value: any) {
      const predicate = (data: any) => {
        const v = data[field];
        switch (op) {
          case "==": return v === value;
          default: return true;
        }
      };
      return next({ hasWhere: true, filters: [...state.filters, predicate] });
    },
    orderBy(field: string, dir?: string) {
      return next({ orderByField: field, orderDir: (dir as any) || "asc" });
    },
    limit(n: number) {
      return next({ limitN: n });
    },
    startAfter(doc: any) {
      return next({ startAfterDoc: doc });
    },
    async get() {
      if (state.hasWhere && failFilteredQueries) {
        const err: any = new Error(
          failCode === 9
            ? "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://..."
            : "7 PERMISSION_DENIED"
        );
        err.code = failCode;
        throw err;
      }
      let docs = Object.entries(mockDocs)
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map(([p, data]) => ({ id: p.slice(prefix.length), path: p, data }))
        .filter(({ data }) => state.filters.every((f) => f(data)));

      if (state.orderByField) {
        const field = state.orderByField;
        const dir = state.orderDir;
        docs.sort((a, b) => {
          const av = a.data[field];
          const bv = b.data[field];
          if (av < bv) return dir === "asc" ? -1 : 1;
          if (av > bv) return dir === "asc" ? 1 : -1;
          return a.id < b.id ? -1 : 1; // stable tiebreak
        });
      }

      if (state.startAfterDoc) {
        const idx = docs.findIndex((d) => d.id === state.startAfterDoc.id);
        docs = idx >= 0 ? docs.slice(idx + 1) : docs;
      }

      if (state.limitN !== null) docs = docs.slice(0, state.limitN);

      return {
        docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        empty: docs.length === 0,
        size: docs.length,
      };
    },
  };
}

function freshQuery(colPath: string) {
  return buildQuery(colPath, {
    filters: [], hasWhere: false, orderByField: null, orderDir: "asc", limitN: null, startAfterDoc: null,
  });
}

const mockDb = {
  collection(path: string) {
    return freshQuery(path);
  },
};

jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "test-key-hash",
  programId: "vector" as any,
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

function seedSchedule(id: string, overrides: Partial<any> = {}) {
  seedDoc(`tenants/${mockAuth.userId}/schedules/${id}`, {
    id,
    name: `schedule-${id}`,
    target: "iso",
    enabled: true,
    createdAt: `2026-08-${String(1 + (Number(id.replace(/\D/g, "")) % 28)).padStart(2, "0")}T00:00:00.000Z`,
    ...overrides,
  });
}

beforeEach(() => {
  mockDocs = {};
  failFilteredQueries = false;
  failCode = 9;
});

// ─────────────────────────────────────────────────────────────────────────

describe("listSchedulesHandler -- failed-query fallback", () => {
  test("DoD 1: filtered query with no backing index returns the correct rows, not an error or empty set", async () => {
    seedSchedule("s1", { target: "iso", enabled: true });
    seedSchedule("s2", { target: "vector", enabled: true });
    failFilteredQueries = true;

    const result = parse(await listSchedulesHandler(mockAuth, { target: "iso" }));

    expect(result.success).toBe(true);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].id).toBe("s1");
  });

  test("DoD 2: response is marked degraded (explicit field, not prose) when the fallback was used", async () => {
    seedSchedule("s1", { enabled: true });
    failFilteredQueries = true;

    const result = parse(await listSchedulesHandler(mockAuth, { enabled: true }));

    expect(result.degraded).toBe(true);
    expect(typeof result.degradedReason).toBe("string");
    expect(result.degradedReason.length).toBeGreaterThan(0);
  });

  test("a healthy query (index present) is explicitly marked NOT degraded", async () => {
    seedSchedule("s1", { enabled: true });
    failFilteredQueries = false;

    const result = parse(await listSchedulesHandler(mockAuth, { enabled: true }));

    expect(result.degraded).toBe(false);
    expect(result.schedules).toHaveLength(1);
  });

  test("DoD 3: a collection larger than one page returns matches from beyond the first page", async () => {
    // schedule_list's public limit caps at 50 -- seed well past that so a
    // single-capped-page fallback (the reintroduced defect) cannot pass.
    for (let i = 0; i < 60; i++) {
      seedSchedule(`s${i}`, { target: "iso", enabled: i % 2 === 0 });
    }
    // The 60th doc, oldest by creation order, is enabled=false (i=59 is odd).
    // Put ONE enabled match right at the tail end so it can only be found if
    // pagination actually walks past the first (50-doc) internal page.
    seedSchedule("s-tail", {
      target: "iso",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z", // oldest -> sorts last in desc order
    });
    failFilteredQueries = true;

    const result = parse(await listSchedulesHandler(mockAuth, { target: "iso", enabled: true, limit: 50 }));

    expect(result.degraded).toBe(true);
    const ids = result.schedules.map((s: any) => s.id);
    // The FALLBACK_PAGE_SIZE (300) internal scan must have walked past
    // position 61 in the unfiltered createdAt-desc order to find this match;
    // a fallback that (wrongly) filtered only one args.limit=50-row unfiltered
    // page would never see it.
    expect(ids).toContain("s-tail");
  });

  test("degraded path: returned is the page size, matchedTotal is the true count, truncated makes the gap explicit", async () => {
    for (let i = 0; i < 60; i++) seedSchedule(`s${i}`, { enabled: true });
    failFilteredQueries = true;

    const result = parse(await listSchedulesHandler(mockAuth, { enabled: true, limit: 50 }));

    expect(result.degraded).toBe(true);
    expect(result.schedules).toHaveLength(50);
    // `returned` means the SAME thing in both paths: this page's size. It is
    // never the true collection-wide match count -- that ambiguity is exactly
    // the class of defect this PR fixes (a field meaning two different things
    // depending on which branch produced it).
    expect(result.returned).toBe(50);
    expect(result.matchedTotal).toBe(60);
    expect(result.truncated).toBe(true);
  });

  test("healthy path: returned reflects what was actually sent back, not a lying page-size 'total'", async () => {
    for (let i = 0; i < 5; i++) seedSchedule(`s${i}`, { enabled: true });
    failFilteredQueries = false;

    const result = parse(await listSchedulesHandler(mockAuth, { limit: 3 }));

    expect(result.returned).toBe(3);
    expect(result.schedules).toHaveLength(3);
    expect(result.matchedTotal).toBeUndefined(); // only meaningful once a fallback scan has actually run
    expect(result.truncated).toBeUndefined();
    expect(result.total).toBeUndefined(); // the old, misleading field is gone
  });

  test("R1: a non-FAILED_PRECONDITION error still fails unmistakably (no silent fallback)", async () => {
    seedSchedule("s1", { target: "iso" });
    failFilteredQueries = true;
    failCode = 7; // PERMISSION_DENIED -- not the missing-index shape

    await expect(listSchedulesHandler(mockAuth, { target: "iso" })).rejects.toThrow("PERMISSION_DENIED");
  });

  test("DoD 4 / MCP stdio + REST wiring: the shared tool registry's schedule_list resolves to the fixed handler", async () => {
    // src/tools/index.ts spreads schedule.handlers into the single TOOL_HANDLERS
    // map that both index.ts (stdio) and transport/rest.ts's callTool() read
    // from -- proving this registration is the fixed handler proves both.
    seedSchedule("s1", { enabled: true });
    failFilteredQueries = true;

    const handler = scheduleToolHandlers["schedule_list"];
    expect(handler).toBe(listSchedulesHandler);
    const result = parse(await handler(mockAuth, { enabled: true }));
    expect(result.degraded).toBe(true);
    expect(result.schedules).toHaveLength(1);
  });
});
