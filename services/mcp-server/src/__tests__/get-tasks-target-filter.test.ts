/**
 * Regression test: get_tasks target parameter must be honored for all key types.
 *
 * Bug (2026-06-11): dispatch_get_tasks ignored `target` for non-legacy program keys.
 * When ISO called get_tasks(target: "beck"), it received ISO's own tasks instead.
 * The `target` param was only applied client-side for "legacy" keys — all other
 * program keys silently fell back to caller scope (auth.programId).
 *
 * Fix: if `target` is specified, the Firestore query always filters by that target,
 * regardless of the caller's programId. NEVER fall back to caller scope when a
 * target is explicitly named.
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
};
const mockQuery: MockQuery = {
  where: jest.fn(function (field: string, op: string, val: unknown) {
    whereCallLog.push([field, op, val]);
    return mockQuery;
  }),
  orderBy: jest.fn(() => mockQuery),
  limit: jest.fn(() => mockQuery),
  get: jest.fn(() => Promise.resolve(mockSnapshot)),
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

function targetWhereArgs(): Array<[string, string, unknown]> {
  return whereCallLog.filter(([field]) => field === "target");
}

beforeEach(() => {
  jest.clearAllMocks();
  whereCallLog.length = 0;
});

describe("get_tasks target filter — P1 regression (2026-06-11)", () => {
  it("program key with explicit target: queries the named target, not caller scope", async () => {
    await getTasksHandler(makeAuth("iso"), { target: "beck", status: "created" });

    const targetFilters = targetWhereArgs();
    expect(targetFilters).toHaveLength(1);
    // Must use "==" on the named target — never "in" with auth.programId
    expect(targetFilters[0]).toEqual(["target", "==", "beck"]);
  });

  it("program key with explicit target=self: queries own target (not in-array fallback)", async () => {
    await getTasksHandler(makeAuth("basher"), { target: "basher", status: "created" });

    const targetFilters = targetWhereArgs();
    expect(targetFilters).toHaveLength(1);
    expect(targetFilters[0]).toEqual(["target", "==", "basher"]);
  });

  it("program key with NO target: defaults to own queue + broadcast (in-array)", async () => {
    await getTasksHandler(makeAuth("basher"), { status: "created" });

    const targetFilters = targetWhereArgs();
    expect(targetFilters).toHaveLength(1);
    expect(targetFilters[0][0]).toBe("target");
    expect(targetFilters[0][1]).toBe("in");
    // Must include the caller's own programId and broadcast
    const values = targetFilters[0][2] as string[];
    expect(values).toContain("basher");
    expect(values).toContain("all");
  });

  it("legacy key with explicit target: queries named target, not everything", async () => {
    await getTasksHandler(makeAuth("legacy"), { target: "casp", status: "created" });

    const targetFilters = targetWhereArgs();
    expect(targetFilters).toHaveLength(1);
    expect(targetFilters[0]).toEqual(["target", "==", "casp"]);
  });

  it("legacy key with NO target: no target filter (sees everything in tenant)", async () => {
    await getTasksHandler(makeAuth("legacy"), { status: "created" });

    const targetFilters = targetWhereArgs();
    // No target filter should be applied — legacy key without target sees all
    expect(targetFilters).toHaveLength(0);
  });

  it("CRITICAL: caller A with target B never receives caller A's tasks instead", async () => {
    // This is the exact bug: iso calls get_tasks(target: "beck") and gets iso's tasks.
    // After fix: the Firestore query must NOT include auth.programId in any form.
    await getTasksHandler(makeAuth("iso"), { target: "beck", status: "created" });

    const targetFilters = targetWhereArgs();
    // Verify "iso" appears nowhere in the target filter value
    for (const [, , val] of targetFilters) {
      if (Array.isArray(val)) {
        expect(val).not.toContain("iso");
      } else {
        expect(val).not.toBe("iso");
      }
    }
  });
});
