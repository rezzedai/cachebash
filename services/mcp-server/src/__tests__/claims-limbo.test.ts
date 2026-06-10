/**
 * Claims Limbo-Trap Tests — Wave B item B1-server
 *
 * The active-unclaimed limbo trap (vector-grid-improvement-review-2026-06-09):
 * claim_task never wrote claimedBy, so unclaim authz (sessionId vs programId)
 * locked owners out of self-recovery and sweepers had no owner field to key
 * on; claim idempotency broke on null/undefined sessionId mismatch.
 *
 * Verifies:
 *   1. claim writes claimedBy + claimedAt
 *   2. claim retry without sessionId is idempotent (null/undefined normalized)
 *   3. claim retry by the claiming program is idempotent (claimedBy match)
 *   4. unclaim authorized for the claiming OWNER via claimedBy
 *   5. unclaim reverts to created, clears claimedBy/claimedAt, bumps unclaimCount
 *   6. unclaim still denied for unrelated programs
 */

// Mock external dependencies before imports
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

const mockTx = {
  get: jest.fn(),
  update: jest.fn(),
};
const mockDb = {
  doc: jest.fn(() => ({ path: "tenants/u1/tasks/t1" })),
  runTransaction: jest.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  collection: jest.fn(() => ({ add: jest.fn(() => Promise.resolve()) })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-server-timestamp"),
}));

jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
}));

jest.mock("../modules/analytics.js", () => ({
  emitAnalyticsEvent: jest.fn(),
}));

jest.mock("../modules/github-sync.js", () => ({
  syncTaskClaimed: jest.fn(),
}));

// Import AFTER mocks
import { claimTaskHandler, unclaimTaskHandler } from "../modules/dispatch/claims.js";
import type { AuthContext } from "../auth/authValidator.js";

const AUTH = { userId: "u1", programId: "basher", encryptionKey: null } as unknown as AuthContext;
const ISO_AUTH = { userId: "u1", programId: "iso", encryptionKey: null } as unknown as AuthContext;
const OTHER_AUTH = { userId: "u1", programId: "quorra", encryptionKey: null } as unknown as AuthContext;

function taskDoc(data: Record<string, unknown>) {
  mockTx.get.mockResolvedValue({ exists: true, data: () => data });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("B1-server: claim writes owner identity", () => {
  it("claim writes claimedBy=programId and claimedAt", async () => {
    taskDoc({ status: "created", title: "t", type: "task", priority: "normal", action: "queue" });

    const res = parse((await claimTaskHandler(AUTH, { taskId: "t1", sessionId: "basher" })) as never);

    expect(res.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active", claimedBy: "basher", claimedAt: expect.anything() }),
    );
  });

  it("claim retry WITHOUT sessionId is idempotent (null/undefined normalized)", async () => {
    // First claim wrote sessionId: null (claim_task with no sessionId). The
    // retry used to compare null === undefined → contention → stranded task.
    taskDoc({ status: "active", sessionId: null, claimedBy: "basher", title: "t" });

    const res = parse((await claimTaskHandler(AUTH, { taskId: "t1" })) as never);

    expect(res.success).toBe(true);
    expect(res.alreadyClaimed).toBe(true);
  });

  it("claim retry by the claiming program is idempotent via claimedBy", async () => {
    taskDoc({ status: "active", sessionId: "basher.task-9", claimedBy: "basher", title: "t" });

    const res = parse((await claimTaskHandler(AUTH, { taskId: "t1", sessionId: "different-session" })) as never);

    expect(res.success).toBe(true);
    expect(res.alreadyClaimed).toBe(true);
  });

  it("claim by another program on an active task is contention", async () => {
    taskDoc({ status: "active", sessionId: "basher.task-9", claimedBy: "basher", title: "t" });

    const res = parse((await claimTaskHandler(OTHER_AUTH, { taskId: "t1", sessionId: "quorra" })) as never);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not claimable/);
  });
});

describe("B1-server: unclaim self-recovery + cleanup", () => {
  it("claiming OWNER can unclaim via claimedBy even when sessionId never matches programId", async () => {
    taskDoc({ status: "active", sessionId: "basher.task-9", claimedBy: "basher", unclaimCount: 0 });

    const res = parse((await unclaimTaskHandler(AUTH, { taskId: "t1", reason: "manual" })) as never);

    expect(res.success).toBe(true);
    expect(res.unclaimCount).toBe(1);
    expect(mockTx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "created",
        sessionId: null,
        claimedBy: null,
        claimedAt: null,
        unclaimCount: 1,
      }),
    );
  });

  it("unrelated program cannot unclaim", async () => {
    taskDoc({ status: "active", sessionId: "basher.task-9", claimedBy: "basher", unclaimCount: 0 });

    const res = parse((await unclaimTaskHandler(OTHER_AUTH, { taskId: "t1" })) as never);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unauthorized/);
  });

  it("iso can always unclaim; circuit breaker flags at 3", async () => {
    taskDoc({ status: "active", sessionId: null, claimedBy: null, unclaimCount: 2 });

    const res = parse((await unclaimTaskHandler(ISO_AUTH, { taskId: "t1", reason: "stale_recovery" })) as never);

    expect(res.success).toBe(true);
    expect(res.unclaimCount).toBe(3);
    expect(res.flagged).toBe(true);
  });
});
