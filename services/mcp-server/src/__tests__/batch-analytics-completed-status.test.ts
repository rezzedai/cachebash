/**
 * batch analytics completed_status gap (companion to #426):
 *
 * #426 fixed the SINGLE-completion path's emitAnalyticsEvent call
 * (toolName: "complete_task", completion.ts ~line 717) to carry
 * `completed_status`, and added the plumbing in analytics.ts
 * (EmitAnalyticsParams.completed_status?: CompletedStatus, plus the
 * write-whitelist line `if (params.completed_status) event.completed_status
 * = params.completed_status;`). completion-analytics-divergence.test.ts
 * explicitly flagged the batch path's emitAnalyticsEvent call
 * (toolName: "batch_complete_tasks") as having the same gap but out of
 * scope for that suite.
 *
 * This suite closes that gap: the batch path's emitAnalyticsEvent call must
 * also carry completed_status verbatim, for all five values. The fix is
 * purely additive -- it does NOT touch the `success` boolean on that same
 * call (`success: args.completed_status !== "FAILED"`, unchanged from #426's
 * single-path divergence, which is why this suite does not assert `success`
 * at all -- that's already pinned by completion-analytics-divergence.test.ts).
 *
 * Asserts the actual payload field value, not merely that emitAnalyticsEvent
 * was called -- a call that fired without completed_status would also
 * satisfy "was called".
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
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn(), computeHash: jest.fn(() => "hash") }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCompleted: jest.fn() }));
jest.mock("../modules/webhook.js", () => ({ dispatchTaskWebhooks: jest.fn(() => Promise.resolve()) }));

import { batchCompleteTasksHandler } from "../modules/dispatch/completion.js";
import type { AuthContext } from "../auth/authValidator.js";
import { emitAnalyticsEvent } from "../modules/analytics.js";

const mockEmitAnalyticsEvent = emitAnalyticsEvent as jest.Mock;

const ENC = Buffer.from("test-encryption-key-32-bytes-long!!!");

function auth(programId: string): AuthContext {
  return { userId: "u1", programId, apiKeyHash: "h", encryptionKey: ENC, capabilities: ["*"], rateLimitTier: "internal" } as AuthContext;
}

function taskDoc(claimedBy: string | null) {
  const data = () => ({
    status: "active",
    claimedBy,
    sessionId: claimedBy ?? null,
    policy_mode: null,
    stateTransitions: [],
    title: "test",
    type: "task",
    priority: "normal",
    source: "iso",
    target: "basher",
  });
  mockTx.get.mockResolvedValue({ exists: true, data });
  mockDoc.mockReturnValue({ path: "tenants/u1/tasks/t1", get: jest.fn(() => Promise.resolve({ exists: false })) });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => { jest.clearAllMocks(); });

const STATUSES = ["SUCCESS", "FAILED", "SKIPPED", "CANCELLED", "PARTIAL"] as const;

describe("batch_complete_tasks analytics payload carries completed_status (companion to #426)", () => {
  it.each(STATUSES)("completed_status=%s: batch analytics payload carries completed_status verbatim", async (status) => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"],
      completed_status: status,
      successorTaskId: status === "PARTIAL" ? "t2" : undefined,
      result: "x",
      model: "sonnet",
      provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const call = mockEmitAnalyticsEvent.mock.calls.find(([, payload]) => payload.toolName === "batch_complete_tasks");
    expect(call).toBeDefined();
    const [, payload] = call!;
    // Not just "was called" -- the actual field value must be present and
    // must match the input completed_status, for every value.
    expect(payload.completed_status).toBe(status);

    // Regression guard: the success boolean on this same call is untouched
    // (#426's deliberate divergence -- SKIPPED/CANCELLED/PARTIAL still read
    // as success:true here, matching the single-path analytics semantics).
    expect(payload.success).toBe(status !== "FAILED");
  });
});
