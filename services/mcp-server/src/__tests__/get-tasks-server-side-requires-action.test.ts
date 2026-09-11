/**
 * WP-2 (cost PDR, PR #1331 §2): get_tasks must push requires_action server-side
 * so a poll reads only actionable rows instead of every created task in the
 * tenant (4,138 created rows, ~40 actionable, at time of writing).
 *
 * Mobile constraint (hard): the mobile key must keep TODAY's semantics
 * exactly — no server-side requires_action clause, so the post-filter's
 * missing-field-as-true default still surfaces the target:"user" alerts that
 * WP-1 deliberately left without the field. See tasks.ts:157-158,177-190.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), classifyTask: jest.fn(() => "standard") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCreated: jest.fn() }));
jest.mock("../webhooks/dispatcher-notify.js", () => ({ notifyDispatcher: jest.fn() }));

// Capture where() calls so we can assert on them
const whereCallLog: Array<[string, string, unknown]> = [];

const mockSnapshot = { docs: [] };
type MockQuery = {
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  get: jest.Mock;
  count: jest.Mock;
};
const mockQuery: MockQuery = {
  where: jest.fn(function (field: string, op: string, val: unknown) {
    whereCallLog.push([field, op, val]);
    return mockQuery;
  }),
  orderBy: jest.fn(() => mockQuery),
  limit: jest.fn(() => mockQuery),
  get: jest.fn(() => Promise.resolve(mockSnapshot)),
  count: jest.fn(() => ({ get: jest.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })) })),
};
const mockDb = {
  collection: jest.fn(() => mockQuery),
  batch: jest.fn(() => ({ update: jest.fn(), commit: jest.fn(() => Promise.resolve()) })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

import { getTasksHandler } from "../modules/dispatch/tasks.js";
import type { AuthContext } from "../auth/authValidator.js";

function makeAuth(programId: string): AuthContext {
  return {
    userId: "u1",
    programId,
    apiKeyHash: "hash",
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    capabilities: ["*"],
    rateLimitTier: "internal",
  } as AuthContext;
}

function requiresActionWhereArgs(): Array<[string, string, unknown]> {
  return whereCallLog.filter(([field]) => field === "requires_action");
}

beforeEach(() => {
  jest.clearAllMocks();
  whereCallLog.length = 0;
});

describe("get_tasks server-side requires_action filter (WP-2)", () => {
  it("program key, default (true): issues where(requires_action, ==, true) server-side", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "created" });

    const filters = requiresActionWhereArgs();
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual(["requires_action", "==", true]);
  });

  it("program key, explicit false: issues where(requires_action, ==, false) server-side", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "created", requires_action: false });

    const filters = requiresActionWhereArgs();
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual(["requires_action", "==", false]);
  });

  it("program key, requires_action: null: issues no server-side clause", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "created", requires_action: null });

    expect(requiresActionWhereArgs()).toHaveLength(0);
  });

  it("MOBILE CONSTRAINT: mobile key's default read issues no server-side clause", async () => {
    await getTasksHandler(makeAuth("mobile"), { status: "created" });

    expect(requiresActionWhereArgs()).toHaveLength(0);
  });

  it("MOBILE CONSTRAINT: mobile key never gets the clause even if it passes requires_action:true explicitly", async () => {
    await getTasksHandler(makeAuth("mobile"), { status: "created", requires_action: true });

    expect(requiresActionWhereArgs()).toHaveLength(0);
  });

  it("MOBILE CONSTRAINT: mobile key's default read still returns a missing-field row (today's behaviour)", async () => {
    const missingFieldDoc = {
      id: "task-missing-field",
      data: () => ({
        type: "task",
        title: "alert for user",
        target: "user",
        status: "created",
        // requires_action deliberately absent — WP-1 left target:"user" rows unbackfilled.
      }),
    };
    mockQuery.get.mockResolvedValueOnce({ docs: [missingFieldDoc] });

    const result = await getTasksHandler(makeAuth("mobile"), { status: "created" });
    const parsed = JSON.parse(result.content[0].text as string);

    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0].id).toBe("task-missing-field");
  });

  it("INDEX CONSTRAINT: status:\"all\" issues no server-side clause (no composite index covers it)", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "all" });

    expect(requiresActionWhereArgs()).toHaveLength(0);
  });

  it("INDEX CONSTRAINT: a type filter issues no server-side clause (no composite index covers it)", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "created", type: "question" });

    expect(requiresActionWhereArgs()).toHaveLength(0);
  });

  it("the indexed hot path (status:created, default type) still gets the clause", async () => {
    await getTasksHandler(makeAuth("iso"), { status: "created" });

    expect(requiresActionWhereArgs()).toEqual([["requires_action", "==", true]]);
  });
});
