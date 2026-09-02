/**
 * R1.2/R1.3 — partial completion state + successor-id enforcement
 * (grid/plans/ISO-plan-dispatch-defects-1-and-2.md).
 *
 * Before this fix, completed_status was SUCCESS | FAILED | SKIPPED | CANCELLED.
 * ISO hit this on 2026-08-11 closing two trackers where real work had shipped
 * but most of the scope had not: neither SUCCESS (dishonestly implies full
 * completion) nor CANCELLED (understates what shipped) was an honest close,
 * and there was no way to say "this continues in task X".
 *
 * R1.2 adds "PARTIAL", distinguishable from SUCCESS in the stored record.
 * R1.3 makes the layer (not convention) refuse a PARTIAL close that doesn't
 * carry a successorTaskId, and succeed once one is supplied. ISO performed
 * the successor-first-then-close ritual by hand three times on 2026-08-11
 * and still got a related field wrong each time — a ritual that depends on
 * memory is the exact failure mode being closed here.
 *
 * This suite proves the SPECIFIC behavior, not just "throws" / "succeeds":
 *   - PARTIAL without a successor is refused, and the refusal names the
 *     missing field (not a generic/lifecycle error).
 *   - The exact same call WITH a successorTaskId succeeds.
 *   - The stored completed_status is actually "PARTIAL", not silently
 *     coerced to SUCCESS/CANCELLED, and successorTaskId is actually
 *     persisted onto the task document.
 *   - Non-PARTIAL completions are unaffected (successorTaskId stays optional
 *     everywhere else) — guards against over-enforcement.
 *   - The relay-schemas.ts `outcome: "partial"` enum (an unrelated RESULT
 *     message field) is untouched by this change.
 *
 * Amendment (ISO review gap): successorTaskId was persisted to Firestore but
 * never reached anything that leaves the system — the emitted event
 * (emitEvent) and the outbound webhook payload (dispatchTaskWebhooks) both
 * carried completed_status but not successorTaskId, so an external consumer
 * saw a PARTIAL completion with no way to discover where the remaining scope
 * continues. The tests below assert the ACTUAL field value on the emitted
 * event / webhook payload, not merely that emitEvent / dispatchTaskWebhooks
 * were called — a bare "was called" assertion would still pass without the
 * fix.
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
jest.mock("../modules/webhook.js", () => ({ dispatchTaskWebhooks: jest.fn(() => Promise.resolve()) }));

import { completeTaskHandler, batchCompleteTasksHandler } from "../modules/dispatch/completion.js";
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
  });
  mockTx.get.mockResolvedValue({ exists: true, data });
  mockDoc.mockReturnValue({ path: "tenants/u1/tasks/t1", get: jest.fn(() => Promise.resolve({ exists: false })) });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => { jest.clearAllMocks(); });

describe("R1.3 — PARTIAL completion requires a successorTaskId (completeTaskHandler)", () => {
  it("REFUSES a PARTIAL completion with NO successorTaskId (negative control)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "PARTIAL", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(false);
    // Must name the specific missing field, not a generic/lifecycle error —
    // a bare "throws" assertion would also pass for an unrelated failure.
    expect(res.error).toMatch(/successorTaskId/);
    expect(res.error).toMatch(/PARTIAL/);
    // Refused before any mutation — the layer enforces this, not convention.
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  });

  it("SUCCEEDS with the exact same call plus a successorTaskId (positive control)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "PARTIAL", successorTaskId: "t2", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    const [, updateFields] = mockTx.update.mock.calls[0];
    // R1.2: the stored state is actually PARTIAL, not coerced to SUCCESS/CANCELLED.
    expect(updateFields.completed_status).toBe("PARTIAL");
    expect(updateFields.completed_status).not.toBe("SUCCESS");
    // R1.3: the successor id is actually persisted onto the task record.
    expect(updateFields.successorTaskId).toBe("t2");
  });

  it("does not require successorTaskId for SUCCESS (over-enforcement guard)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    const [, updateFields] = mockTx.update.mock.calls[0];
    expect(updateFields.completed_status).toBe("SUCCESS");
    expect(updateFields.successorTaskId).toBeUndefined();
  });

  it("does not require successorTaskId for CANCELLED/SKIPPED/FAILED", async () => {
    for (const status of ["CANCELLED", "SKIPPED", "FAILED"] as const) {
      taskDoc("basher");
      const res = parse(await completeTaskHandler(auth("basher"), {
        taskId: "t1", completed_status: status, result: "n/a", model: "sonnet", provider: "anthropic",
      }) as never);
      expect(res.success).toBe(true);
    }
  });

  it("rejects an empty-string successorTaskId as absent (not a real id)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "PARTIAL", successorTaskId: "", result: "x", model: "sonnet", provider: "anthropic",
    }) as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/successorTaskId/);
  });

  it("propagates successorTaskId onto the emitted TASK_SUCCEEDED event (Amendment: emitEvent)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "PARTIAL", successorTaskId: "t2", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const [, eventPayload] = mockEmitEvent.mock.calls[0];
    // Not just "was called" — the actual field value must be the successor id.
    expect(eventPayload.successorTaskId).toBe("t2");
    expect(eventPayload.completed_status).toBe("PARTIAL");
  });

  it("propagates successorTaskId onto the outbound webhook payload (Amendment: dispatchTaskWebhooks)", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "PARTIAL", successorTaskId: "t2", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    expect(mockDispatchTaskWebhooks).toHaveBeenCalledTimes(1);
    const [, webhookEvent] = mockDispatchTaskWebhooks.mock.calls[0];
    // task was spread from a pre-update read of taskData, so successorTaskId
    // must be set explicitly (like completed_status/result already are) —
    // asserting the actual field value catches a regression to spread-only.
    expect(webhookEvent.task.successorTaskId).toBe("t2");
    expect(webhookEvent.task.completed_status).toBe("PARTIAL");
  });

  it("does not set successorTaskId on the emitted event or webhook payload when none was supplied", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), {
      taskId: "t1", completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(true);
    const [, eventPayload] = mockEmitEvent.mock.calls[0];
    expect(eventPayload.successorTaskId).toBeUndefined();
    const [, webhookEvent] = mockDispatchTaskWebhooks.mock.calls[0];
    expect(webhookEvent.task.successorTaskId).toBeUndefined();
  });
});

describe("R1.3 — PARTIAL completion requires a successorTaskId (batchCompleteTasksHandler)", () => {
  it("REFUSES a batch PARTIAL completion with NO successorTaskId (negative control)", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "PARTIAL", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/successorTaskId/);
    expect(res.error).toMatch(/PARTIAL/);
    expect(mockTx.update).not.toHaveBeenCalled();
    // Refused up front, before the per-task loop even starts.
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  });

  it("SUCCEEDS with the exact same call plus a successorTaskId (positive control)", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "PARTIAL", successorTaskId: "t2", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, updateFields] = mockTx.update.mock.calls[0];
    expect(updateFields.completed_status).toBe("PARTIAL");
    expect(updateFields.successorTaskId).toBe("t2");
  });

  it("does not require successorTaskId for a batch SUCCESS completion", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);
    expect(res.results[0].success).toBe(true);
  });

  it("propagates successorTaskId onto the emitted TASK_SUCCEEDED event (Amendment: emitEvent, batch)", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "PARTIAL", successorTaskId: "t2", result: "shipped half", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const [, eventPayload] = mockEmitEvent.mock.calls[0];
    // Not just "was called" — the actual field value must be the successor id.
    expect(eventPayload.successorTaskId).toBe("t2");
  });

  it("does not set successorTaskId on the emitted batch event when none was supplied", async () => {
    taskDoc("basher");
    const res = parse(await batchCompleteTasksHandler(auth("basher"), {
      taskIds: ["t1"], completed_status: "SUCCESS", result: "done", model: "sonnet", provider: "anthropic",
    }) as never);

    expect(res.results[0].success).toBe(true);
    const [, eventPayload] = mockEmitEvent.mock.calls[0];
    expect(eventPayload.successorTaskId).toBeUndefined();
  });
});
