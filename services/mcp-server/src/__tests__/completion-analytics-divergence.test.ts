/**
 * Regression test pinning a DELIBERATE divergence in completeTaskHandler
 * (services/mcp-server/src/modules/dispatch/completion.ts) between two
 * "success" booleans computed from the same completed_status:
 *
 *   1. emitAnalyticsEvent (~line 709, "Analytics: task_lifecycle complete")
 *      writes tenants/{uid}/analytics_events. `success: completed_status
 *      !== "FAILED"` -- SKIPPED/CANCELLED/PARTIAL all count as success. No
 *      in-repo reader (confirmed by grep); external/analytics consumption
 *      only. Its historical meaning must not move.
 *
 *   2. updateProgramStats (~line 782, "Wave 16: Update program stats") writes
 *      program_stats.{taskTypeSuccessRates,tagSuccessRates}, which IS read
 *      in-repo by dispatch_suggest_target and dispatchHandler's auto-routing.
 *      `success: completed_status === "SUCCESS"` -- strict, because a program
 *      that only SKIPPED/CANCELLED/PARTIAL-closed a task did not do the work
 *      as asked, and loosening this would misroute work.
 *
 * This is not a bug: a future "let's make these consistent" refactor is
 * exactly what this suite must catch. It also pins the additive-only fix
 * that gives the analytics event a `completed_status` field so an external
 * consumer can compute whichever meaning it wants without us redefining
 * `success` itself.
 *
 * Scope note: the batch-completion path's emitAnalyticsEvent call
 * (toolName: "batch_complete_tasks", ~line 906) has the same
 * missing-completed_status gap but is NOT covered here -- out of scope,
 * flagged separately.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

const mockTx = { get: jest.fn(), update: jest.fn(), set: jest.fn() };
const mockCollection = { add: jest.fn(() => Promise.resolve()) };

function taskSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      status: "active",
      claimedBy: "basher",
      sessionId: "basher",
      policy_mode: null,
      stateTransitions: [],
      title: "test",
      type: "task",
      priority: "normal",
      source: "iso",
      target: "basher",
      tags: undefined,
      startedAt: undefined,
      ...overrides,
    }),
  };
}

const mockDoc = jest.fn(() => ({
  path: "tenants/u1/tasks/t1",
  get: jest.fn(() => Promise.resolve(taskSnapshot())),
}));

const mockDb = {
  doc: mockDoc,
  runTransaction: jest.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  collection: jest.fn(() => mockCollection),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), computeHash: jest.fn(() => "hash") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCompleted: jest.fn() }));
jest.mock("../modules/webhook.js", () => ({ dispatchTaskWebhooks: jest.fn(() => Promise.resolve()) }));

import { completeTaskHandler } from "../modules/dispatch/completion.js";
import type { AuthContext } from "../auth/authValidator.js";
import { emitAnalyticsEvent } from "../modules/analytics.js";

const mockEmitAnalyticsEvent = emitAnalyticsEvent as jest.Mock;

const ENC = Buffer.from("test-encryption-key-32-bytes-long!!!");

function auth(programId: string): AuthContext {
  return { userId: "u1", programId, apiKeyHash: "h", encryptionKey: ENC, capabilities: ["*"], rateLimitTier: "internal" } as AuthContext;
}

// Sets up both the main-transaction tx.get() and the post-transaction
// taskRef.get() (used for the Wave 16 updateProgramStats call) to resolve
// with a real snapshot (exists:true + working .data()), unlike the
// exists:false stub used by other completion test files -- that stub makes
// `taskDoc.data()?.type` throw, which is silently swallowed by
// updateProgramStats' own try/catch, so those other suites never actually
// observe a real program_stats write. This suite needs a working snapshot
// so updateProgramStats' tx.set() call actually happens and can be asserted.
function setUpTaskDoc() {
  const snap = taskSnapshot();
  mockTx.get.mockResolvedValue(snap);
  mockDoc.mockReturnValue({ path: "tenants/u1/tasks/t1", get: jest.fn(() => Promise.resolve(snap)) });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => { jest.clearAllMocks(); });

const STATUSES = ["SUCCESS", "FAILED", "SKIPPED", "CANCELLED", "PARTIAL"] as const;

describe("completion analytics/program_stats success divergence (deliberate, must stay divergent)", () => {
  it.each(STATUSES)("completed_status=%s: analytics payload carries completed_status verbatim", async (status) => {
    setUpTaskDoc();
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1",
      completed_status: status,
      successorTaskId: status === "PARTIAL" ? "t2" : undefined,
      result: "x",
      model: "sonnet",
      provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    const call = mockEmitAnalyticsEvent.mock.calls.find(([, payload]) => payload.toolName === "complete_task");
    expect(call).toBeDefined();
    const [, payload] = call!;
    // Not just "was called" -- the actual field value must be present and
    // must match the input completed_status, for every value.
    expect(payload.completed_status).toBe(status);
  });

  it.each([
    ["SUCCESS", true, true],
    ["FAILED", false, false],
    ["SKIPPED", true, false],
    ["CANCELLED", true, false],
    ["PARTIAL", true, false],
  ] as const)(
    "completed_status=%s: analytics success=%s, program_stats success=%s (divergence pinned)",
    async (status, expectedAnalyticsSuccess, expectedProgramStatsSuccess) => {
      setUpTaskDoc();
      const res = parse(await completeTaskHandler(auth("basher"), {
        taskId: "t1",
        completed_status: status,
        successorTaskId: status === "PARTIAL" ? "t2" : undefined,
        result: "x",
        model: "sonnet",
        provider: "anthropic",
      }) as never);

      expect(res.success).toBe(true);

      // 1. Analytics boolean: !== "FAILED" (SKIPPED/CANCELLED/PARTIAL => true).
      const analyticsCall = mockEmitAnalyticsEvent.mock.calls.find(([, p]) => p.toolName === "complete_task");
      expect(analyticsCall).toBeDefined();
      const [, analyticsPayload] = analyticsCall!;
      expect(analyticsPayload.success).toBe(expectedAnalyticsSuccess);

      // 2. program_stats boolean: strict === "SUCCESS" (SKIPPED/CANCELLED/
      // PARTIAL => false). Asserted via the actual Firestore write
      // updateProgramStats makes (tx.set on the program_stats doc), not via
      // a mocked function call -- updateProgramStats is a private helper in
      // completion.ts and isn't separately mockable.
      // Note: for FAILED, handleAutoQuarantine also calls tx.set (on the
      // program doc, with a `failureCount` payload) via the same mocked
      // tx -- filter to the program_stats write specifically.
      const statsCall = mockTx.set.mock.calls.find(([, p]) => p && p.taskTypeSuccessRates);
      expect(statsCall).toBeDefined();
      const [, statsPayload] = statsCall!;
      const taskTypeStats = statsPayload.taskTypeSuccessRates.task;
      expect(taskTypeStats.total).toBe(1);
      expect(taskTypeStats.success).toBe(expectedProgramStatsSuccess ? 1 : 0);

      // The whole point of this test: for SKIPPED/CANCELLED/PARTIAL the two
      // booleans must DISAGREE. If a future change makes them agree, this
      // fails -- that's the regression this suite exists to catch.
      if (status === "SKIPPED" || status === "CANCELLED" || status === "PARTIAL") {
        expect(analyticsPayload.success).not.toBe(expectedProgramStatsSuccess);
      } else {
        expect(analyticsPayload.success).toBe(expectedProgramStatsSuccess);
      }
    }
  );
});
