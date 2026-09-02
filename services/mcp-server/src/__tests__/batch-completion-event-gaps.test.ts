/**
 * batch-event-gaps (dispatch-defects-1-and-2, ISO-ruled additive-only):
 * two gaps between batchCompleteTasksHandler and completeTaskHandler.
 *
 * 1. The single-completion emitEvent call has always carried completed_status
 *    (the authoritative discriminator between SUCCESS/FAILED/SKIPPED/
 *    CANCELLED/PARTIAL -- event_type is only a coarse TASK_SUCCEEDED/
 *    TASK_FAILED routing hint). The batch path's emitEvent call never did,
 *    so a batch PARTIAL/SKIPPED/CANCELLED completion emitted an event
 *    indistinguishable from a plain SUCCESS.
 *
 * 2. dispatchTaskWebhooks has exactly one call site before this fix -- inside
 *    completeTaskHandler. batchCompleteTasksHandler never dispatched webhooks
 *    at all, so a tenant with a task.completed/task.failed webhook registered
 *    never heard about a batch completion.
 *
 * Both fixes are purely additive: event_type values, the lifecycle
 * transition, and completeTaskHandler's own behavior are all unchanged.
 *
 * This suite asserts the ACTUAL field values on the emitted event and the
 * actual webhook call arguments -- not merely that emitEvent /
 * dispatchTaskWebhooks were called, which the pre-fix code would also
 * satisfy for emitEvent (it was already called, just without
 * completed_status) and which a no-op stub would trivially satisfy for
 * dispatchTaskWebhooks.
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

import { batchCompleteTasksHandler, completeTaskHandler } from "../modules/dispatch/completion.js";
import type { AuthContext } from "../auth/authValidator.js";
import { emitEvent } from "../modules/events.js";
import { dispatchTaskWebhooks } from "../modules/webhook.js";

const mockEmitEvent = emitEvent as jest.Mock;
const mockDispatchTaskWebhooks = dispatchTaskWebhooks as jest.Mock;

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

describe("batch-event-gaps 1: batch emitEvent carries completed_status", () => {
  it("SUCCESS: the emitted event's completed_status field is 'SUCCESS'", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const [, payload] = mockEmitEvent.mock.calls[0];
    expect(payload.completed_status).toBe("SUCCESS");
  });

  it("SKIPPED: the emitted event's completed_status is 'SKIPPED', not silently absent or coerced to SUCCESS", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "SKIPPED", result: "n/a", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, payload] = mockEmitEvent.mock.calls[0];
    expect(payload.completed_status).toBe("SKIPPED");
    expect(payload.completed_status).not.toBe("SUCCESS");
    // event_type stays the coarse routing hint (additive-only ruling: never
    // rename/repurpose an existing event_type value).
    expect(payload.event_type).toBe("TASK_SUCCEEDED");
  });

  it("FAILED: the emitted event's completed_status is 'FAILED', matching the existing TASK_FAILED event_type", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "FAILED", result: "broke", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, payload] = mockEmitEvent.mock.calls[0];
    expect(payload.completed_status).toBe("FAILED");
    expect(payload.event_type).toBe("TASK_FAILED");
  });

  it("PARTIAL: the emitted event carries both completed_status and successorTaskId together", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "PARTIAL", successorTaskId: "t2", result: "half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, payload] = mockEmitEvent.mock.calls[0];
    expect(payload.completed_status).toBe("PARTIAL");
    expect(payload.successorTaskId).toBe("t2");
  });
});

describe("batch-event-gaps 2: batch path dispatches webhooks (previously: none at all)", () => {
  it("dispatches a task.completed webhook for a batch SUCCESS completion", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    expect(mockDispatchTaskWebhooks).toHaveBeenCalledTimes(1);
    const [tenantId, webhookPayload] = mockDispatchTaskWebhooks.mock.calls[0];
    expect(tenantId).toBe("u1");
    expect(webhookPayload.event).toBe("task.completed");
    expect(webhookPayload.taskId).toBe("t1");
    expect(webhookPayload.task.completed_status).toBe("SUCCESS");
    expect(webhookPayload.tenantId).toBe("u1");
  });

  it("dispatches a task.failed webhook for a batch FAILED completion", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "FAILED", result: "broke", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, webhookPayload] = mockDispatchTaskWebhooks.mock.calls[0];
    expect(webhookPayload.event).toBe("task.failed");
  });

  it("dispatches one webhook per task across a multi-task batch", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1", "t1", "t1"], completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.completed).toBe(3);
    expect(mockDispatchTaskWebhooks).toHaveBeenCalledTimes(3);
  });

  it("carries successorTaskId onto the webhook payload for a PARTIAL batch completion", async () => {
    taskDoc("basher");
    await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "PARTIAL", successorTaskId: "t2", result: "half", model: "sonnet", provider: "anthropic",
    });

    const [, webhookPayload] = mockDispatchTaskWebhooks.mock.calls[0];
    expect(webhookPayload.task.successorTaskId).toBe("t2");
    expect(webhookPayload.task.completed_status).toBe("PARTIAL");
  });

  it("does not touch completeTaskHandler's own webhook dispatch (regression guard)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    expect(mockDispatchTaskWebhooks).toHaveBeenCalledTimes(1);
    const [, webhookPayload] = mockDispatchTaskWebhooks.mock.calls[0];
    expect(webhookPayload.event).toBe("task.completed");
    expect(webhookPayload.taskId).toBe("t1");
  });
});
