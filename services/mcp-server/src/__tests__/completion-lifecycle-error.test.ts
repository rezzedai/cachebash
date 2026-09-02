/**
 * R2.1 — actionable remedy text for the "complete an unclaimed task" error
 * (grid/plans/ISO-plan-dispatch-defects-1-and-2.md).
 *
 * Before this fix, completing a task that was never claimed (status
 * "created") failed with the generic, remedy-free lifecycle message
 * "Invalid transition for task: created -> done" — every caller had to
 * already know (from memory, or by reading engine.ts) that the fix is to
 * call dispatch_claim_task first. This suite proves the resulting error
 * message names that remedy, for both the single and batch complete paths.
 *
 * The remedy text lives at the task-completion call site
 * (modules/dispatch/completion.ts, via describeTaskCompletionError in
 * shared.ts), not inside the generic lifecycle engine — the engine serves
 * tasks, sessions, dreams, and sprint-stories alike and has no concept of
 * "claiming" a task.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

const mockTx = { get: jest.fn(), update: jest.fn() };
const mockCollection = { add: jest.fn(() => Promise.resolve()) };

const mockDoc = jest.fn(() => ({
  path: "tenants/u1/tasks/t1",
  get: jest.fn(() => Promise.resolve({ exists: false })),
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
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCompleted: jest.fn() }));

import { completeTaskHandler, batchCompleteTasksHandler } from "../modules/dispatch/completion.js";
import type { AuthContext } from "../auth/authValidator.js";

const ENC = Buffer.from("test-encryption-key-32-bytes-long!!!");

function auth(programId: string): AuthContext {
  return { userId: "u1", programId, apiKeyHash: "h", encryptionKey: ENC, capabilities: ["*"], rateLimitTier: "internal" } as AuthContext;
}

/** An unclaimed task (status "created", claimedBy null). Only iso/admin
 * callers can reach the lifecycle transition for a task they haven't
 * claimed — anyone else is stopped earlier by the ownership gate, so the
 * caller here must be "iso" to exercise the transition path itself. */
function unclaimedTaskDoc() {
  const data = () => ({
    status: "created",
    claimedBy: null,
    sessionId: null,
    policy_mode: null,
    stateTransitions: [],
    title: "test",
    type: "task",
    priority: "normal",
  });
  mockTx.get.mockResolvedValue({ exists: true, data });
  mockDoc.mockReturnValue({ path: "tenants/u1/tasks/t1", get: jest.fn(() => Promise.resolve({ exists: false })) });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const ARGS = { taskId: "t1", completed_status: "SUCCESS" as const, result: "done", model: "sonnet", provider: "anthropic" };

beforeEach(() => { jest.clearAllMocks(); });

describe("complete_task on an unclaimed task names the remedy (R2.1)", () => {
  it("completeTaskHandler: error message tells the caller to claim first", async () => {
    unclaimedTaskDoc();
    const res = parse(await completeTaskHandler(auth("iso"), ARGS) as never);

    expect(res.success).toBe(false);
    expect(mockTx.update).not.toHaveBeenCalled();
    // Must name the concrete remedy — not merely confirm a lifecycle error
    // was thrown, which the old unhelpful message would also satisfy.
    expect(res.error).toMatch(/claim/i);
    expect(res.error).toMatch(/before/i);
    expect(res.error).toContain("dispatch_claim_task");
    expect(res.error).toContain("t1");
  });

  it("batchCompleteTasksHandler: per-task error names the remedy", async () => {
    unclaimedTaskDoc();
    const BATCH_ARGS = { taskIds: ["t1"], completed_status: "SUCCESS" as const, result: "done", model: "sonnet", provider: "anthropic" };
    const res = parse(await batchCompleteTasksHandler(auth("iso"), BATCH_ARGS) as never);

    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/claim/i);
    expect(res.results[0].error).toMatch(/before/i);
    expect(res.results[0].error).toContain("dispatch_claim_task");
  });

  it("does not add claim-remedy text to unrelated failures (e.g. unauthorized)", async () => {
    // basher is neither the claiming owner (claimedBy is null) nor iso/admin,
    // so this hits the authz gate, not the lifecycle transition — the
    // remedy text must NOT leak into an unrelated error.
    unclaimedTaskDoc();
    const res = parse(await completeTaskHandler(auth("basher"), ARGS) as never);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unauthorized/);
    expect(res.error).not.toContain("dispatch_claim_task");
  });
});
