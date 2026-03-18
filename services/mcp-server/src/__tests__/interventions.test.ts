/**
 * Intervention Actions Test Suite
 * Tests for retry, abort, reassign, escalate, pause/resume program
 */

import { getTestFirestore, clearFirestoreData, seedTestUser } from "./integration/setup.js";
import { retryTaskHandler, abortTaskHandler, reassignTaskHandler, escalateTaskHandler } from "../modules/dispatch/interventions.js";
import { pauseProgramHandler, resumeProgramHandler, isProgramPaused } from "../modules/pulse.js";
import { createTaskHandler } from "../modules/dispatch/tasks.js";
import { claimTaskHandler } from "../modules/dispatch/claims.js";
import { completeTaskHandler } from "../modules/dispatch/completion.js";
import { registerProgram } from "../modules/programRegistry.js";
import type { AuthContext } from "../auth/authValidator.js";
import { dispatchHandler } from "../modules/dispatch/dispatchHandler.js";

const TEST_USER_ID = "test-interventions-user";

const mockAuth: AuthContext = {
  userId: TEST_USER_ID,
  programId: "iso",
  apiKeyHash: "test-hash",
  capabilities: ["dispatch.write", "pulse.write"],
  encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
  rateLimitTier: "internal",
};

beforeEach(async () => {
  await clearFirestoreData();
  await seedTestUser(TEST_USER_ID);

  // Register test programs
  await registerProgram(TEST_USER_ID, {
    programId: "builder-test",
    displayName: "Test Builder",
    role: "builder",
    color: "#3b82f6",
    groups: ["builders"],
    tags: [],
    createdBy: TEST_USER_ID,
  });

  await registerProgram(TEST_USER_ID, {
    programId: "iso",
    displayName: "ISO",
    role: "orchestrator",
    color: "#8b5cf6",
    groups: ["orchestrators"],
    tags: [],
    createdBy: TEST_USER_ID,
  });

  await registerProgram(TEST_USER_ID, {
    programId: "vector",
    displayName: "VECTOR",
    role: "coordinator",
    color: "#ec4899",
    groups: ["coordinators"],
    tags: [],
    createdBy: TEST_USER_ID,
  });
});

afterEach(async () => {
  await clearFirestoreData();
});

// ─── RETRY TASK ───────────────────────────────────────────────────────────────

describe("Retry Task", () => {
  it("should retry a failed task and reset to created status", async () => {
    const db = getTestFirestore();

    // Create and complete a task with FAILED status
    const createResult = await createTaskHandler(mockAuth, {
      title: "Test failed task",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    // Complete as failed
    await completeTaskHandler(mockAuth, {
      taskId,
      completed_status: "FAILED",
      model: "claude-sonnet-4",
      provider: "anthropic",
      result: "Original failure reason",
    });

    // Verify task is in done state with FAILED status
    const taskDocBefore = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDocBefore.data()?.status).toBe("done");
    expect(taskDocBefore.data()?.completed_status).toBe("FAILED");

    // Retry the task
    const retryResult = await retryTaskHandler(mockAuth, {
      taskId,
      reason: "Transient error resolved",
    });

    const retryData = JSON.parse(retryResult.content[0].text);
    expect(retryData.success).toBe(true);
    expect(retryData.retryCount).toBe(1);

    // Verify task status reset
    const taskDocAfter = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    const taskData = taskDocAfter.data()!;
    expect(taskData.status).toBe("created");
    expect(taskData.claimedBy).toBeNull();
    expect(taskData.result).toBeNull();
    expect(taskData.completed_status).toBeNull();
    expect(taskData.retryCount).toBe(1);
  });

  it("should retry with new target and priority", async () => {
    const db = getTestFirestore();

    // Create and complete a task
    const createResult = await createTaskHandler(mockAuth, {
      title: "Test task",
      target: "builder-test",
      source: "iso",
      priority: "low",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await completeTaskHandler(mockAuth, {
      taskId,
      completed_status: "SUCCESS",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });

    // Retry with new target and priority
    const retryResult = await retryTaskHandler(mockAuth, {
      taskId,
      newTarget: "iso",
      newPriority: "high",
      reason: "Escalating to orchestrator",
    });

    const retryData = JSON.parse(retryResult.content[0].text);
    expect(retryData.success).toBe(true);
    expect(retryData.newTarget).toBe("iso");
    expect(retryData.newPriority).toBe("high");

    // Verify updates
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.target).toBe("iso");
    expect(taskDoc.data()?.priority).toBe("high");
  });

  it("should fail to retry a task that is not done or failed", async () => {
    // Create a task but don't complete it
    const createResult = await createTaskHandler(mockAuth, {
      title: "Active task",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    // Try to retry (should fail)
    const retryResult = await retryTaskHandler(mockAuth, {
      taskId,
    });

    const retryData = JSON.parse(retryResult.content[0].text);
    expect(retryData.success).toBe(false);
    expect(retryData.error).toContain("cannot be retried");
  });

  it("should increment retry count on multiple retries", async () => {
    const db = getTestFirestore();

    // Create and complete a task
    const createResult = await createTaskHandler(mockAuth, {
      title: "Multi-retry task",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await completeTaskHandler(mockAuth, {
      taskId,
      completed_status: "FAILED",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });

    // First retry
    await retryTaskHandler(mockAuth, { taskId });
    let taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.retryCount).toBe(1);

    // Complete again
    await completeTaskHandler(mockAuth, {
      taskId,
      completed_status: "FAILED",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });

    // Second retry
    await retryTaskHandler(mockAuth, { taskId });
    taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.retryCount).toBe(2);
  });
});

// ─── ABORT TASK ───────────────────────────────────────────────────────────────

describe("Abort Task", () => {
  it("should abort an active task and mark as CANCELLED", async () => {
    const db = getTestFirestore();

    // Create and claim a task
    const createResult = await createTaskHandler(mockAuth, {
      title: "Task to abort",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await claimTaskHandler(mockAuth, { taskId });

    // Abort the task
    const abortResult = await abortTaskHandler(mockAuth, {
      taskId,
      reason: "User requested cancellation",
    });

    const abortData = JSON.parse(abortResult.content[0].text);
    expect(abortData.success).toBe(true);
    expect(abortData.previousStatus).toBe("active");

    // Verify task is cancelled
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    const taskData = taskDoc.data()!;
    expect(taskData.status).toBe("done");
    expect(taskData.completed_status).toBe("CANCELLED");
    expect(taskData.result).toBe("User requested cancellation");
  });

  it("should abort a created task", async () => {
    const db = getTestFirestore();

    // Create a task but don't claim it
    const createResult = await createTaskHandler(mockAuth, {
      title: "Pending task to abort",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    // Abort immediately
    const abortResult = await abortTaskHandler(mockAuth, {
      taskId,
      reason: "Task no longer needed",
    });

    const abortData = JSON.parse(abortResult.content[0].text);
    expect(abortData.success).toBe(true);
    expect(abortData.previousStatus).toBe("created");

    // Verify status
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.status).toBe("done");
    expect(taskDoc.data()?.completed_status).toBe("CANCELLED");
  });

  it("should fail to abort a completed task", async () => {
    // Create and complete a task
    const createResult = await createTaskHandler(mockAuth, {
      title: "Completed task",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await completeTaskHandler(mockAuth, {
      taskId,
      completed_status: "SUCCESS",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });

    // Try to abort (should fail)
    const abortResult = await abortTaskHandler(mockAuth, {
      taskId,
      reason: "Attempting to abort completed task",
    });

    const abortData = JSON.parse(abortResult.content[0].text);
    expect(abortData.success).toBe(false);
    expect(abortData.error).toContain("cannot be aborted");
  });
});

// ─── REASSIGN TASK ────────────────────────────────────────────────────────────

describe("Reassign Task", () => {
  it("should reassign a created task to a new target", async () => {
    const db = getTestFirestore();

    // Create task for builder
    const createResult = await createTaskHandler(mockAuth, {
      title: "Task to reassign",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    // Reassign to iso
    const reassignResult = await reassignTaskHandler(mockAuth, {
      taskId,
      newTarget: "iso",
      reason: "Builder capacity full, moving to ISO",
    });

    const reassignData = JSON.parse(reassignResult.content[0].text);
    expect(reassignData.success).toBe(true);
    expect(reassignData.previousTarget).toBe("builder-test");
    expect(reassignData.newTarget).toBe("iso");

    // Verify target changed
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.target).toBe("iso");
  });

  it("should reassign an active task and reset to created", async () => {
    const db = getTestFirestore();

    // Create and claim task
    const createResult = await createTaskHandler(mockAuth, {
      title: "Active task to reassign",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;
    await claimTaskHandler(mockAuth, { taskId });

    // Reassign
    const reassignResult = await reassignTaskHandler(mockAuth, {
      taskId,
      newTarget: "vector",
      reason: "Escalating to coordinator",
    });

    const reassignData = JSON.parse(reassignResult.content[0].text);
    expect(reassignData.success).toBe(true);

    // Verify status reset and claim cleared
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    const taskData = taskDoc.data()!;
    expect(taskData.status).toBe("created");
    expect(taskData.target).toBe("vector");
    expect(taskData.claimedBy).toBeNull();
    expect(taskData.sessionId).toBeNull();
  });

  it("should preserve source and instructions on reassignment", async () => {
    const db = getTestFirestore();

    const createResult = await createTaskHandler(mockAuth, {
      title: "Task with instructions",
      instructions: "Important instructions here",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await reassignTaskHandler(mockAuth, {
      taskId,
      newTarget: "vector",
      reason: "Reassigning",
    });

    // Verify preserved fields
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    const taskData = taskDoc.data()!;
    expect(taskData.source).toBe("iso");
    expect(taskData.instructions).toBe("Important instructions here");
  });

  it("should fail to reassign to unknown target", async () => {
    const createResult = await createTaskHandler(mockAuth, {
      title: "Task",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    const reassignResult = await reassignTaskHandler(mockAuth, {
      taskId,
      newTarget: "nonexistent-program",
      reason: "Testing",
    });

    const reassignData = JSON.parse(reassignResult.content[0].text);
    expect(reassignData.success).toBe(false);
    expect(reassignData.error).toContain("Unknown target");
  });
});

// ─── ESCALATE TASK ────────────────────────────────────────────────────────────

describe("Escalate Task", () => {
  it("should escalate builder task to iso with default chain", async () => {
    const db = getTestFirestore();

    const createResult = await createTaskHandler(mockAuth, {
      title: "Builder task needing escalation",
      target: "builder-test",
      source: "iso",
      priority: "normal",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    // Escalate (should default to iso)
    const escalateResult = await escalateTaskHandler(mockAuth, {
      taskId,
      reason: "Builder cannot complete, needs orchestrator",
    });

    const escalateData = JSON.parse(escalateResult.content[0].text);
    expect(escalateData.success).toBe(true);
    expect(escalateData.escalatedTo).toBe("iso");
    expect(escalateData.newPriority).toBe("high");
    expect(escalateData.previousPriority).toBe("normal");

    // Verify changes
    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    const taskData = taskDoc.data()!;
    expect(taskData.target).toBe("iso");
    expect(taskData.priority).toBe("high");
  });

  it("should escalate iso task to vector", async () => {
    const db = getTestFirestore();

    const createResult = await createTaskHandler(mockAuth, {
      title: "ISO task needing escalation",
      target: "iso",
      source: "builder-test",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    const escalateResult = await escalateTaskHandler(mockAuth, {
      taskId,
      reason: "ISO cannot handle, needs coordinator",
    });

    const escalateData = JSON.parse(escalateResult.content[0].text);
    expect(escalateData.success).toBe(true);
    expect(escalateData.escalatedTo).toBe("vector");

    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.target).toBe("vector");
  });

  it("should escalate vector task and require Flynn", async () => {
    const createResult = await createTaskHandler(mockAuth, {
      title: "Vector task needing escalation",
      target: "vector",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    const escalateResult = await escalateTaskHandler(mockAuth, {
      taskId,
      reason: "Needs Flynn approval",
    });

    const escalateData = JSON.parse(escalateResult.content[0].text);
    expect(escalateData.success).toBe(true);
    expect(escalateData.requiresFlynn).toBe(true);
    expect(escalateData.escalatedTo).toBeNull();
  });

  it("should allow explicit escalation target override", async () => {
    const db = getTestFirestore();

    const createResult = await createTaskHandler(mockAuth, {
      title: "Task with explicit escalation",
      target: "builder-test",
      source: "iso",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    const escalateResult = await escalateTaskHandler(mockAuth, {
      taskId,
      escalateTo: "vector",
      reason: "Skip ISO, go straight to vector",
    });

    const escalateData = JSON.parse(escalateResult.content[0].text);
    expect(escalateData.success).toBe(true);
    expect(escalateData.escalatedTo).toBe("vector");

    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.target).toBe("vector");
  });

  it("should bump priority to high on escalation", async () => {
    const db = getTestFirestore();

    const createResult = await createTaskHandler(mockAuth, {
      title: "Low priority task",
      target: "builder-test",
      source: "iso",
      priority: "low",
    });
    const taskId = JSON.parse(createResult.content[0].text).taskId;

    await escalateTaskHandler(mockAuth, {
      taskId,
      reason: "Urgent",
    });

    const taskDoc = await db.doc(`tenants/${TEST_USER_ID}/tasks/${taskId}`).get();
    expect(taskDoc.data()?.priority).toBe("high");
  });
});

// ─── PAUSE/RESUME PROGRAM ─────────────────────────────────────────────────────

describe("Pause/Resume Program", () => {
  it("should pause a program", async () => {
    const db = getTestFirestore();

    const pauseResult = await pauseProgramHandler(mockAuth, {
      programId: "builder-test",
      reason: "Maintenance window",
    });

    const pauseData = JSON.parse(pauseResult.content[0].text);
    expect(pauseData.success).toBe(true);
    expect(pauseData.paused).toBe(true);

    // Verify paused in Firestore
    const isPaused = await isProgramPaused(TEST_USER_ID, "builder-test");
    expect(isPaused).toBe(true);

    // Verify pause fields
    const programDoc = await db.doc(`tenants/${TEST_USER_ID}/programs/builder-test`).get();
    const programData = programDoc.data()!;
    expect(programData.paused).toBe(true);
    expect(programData.pauseReason).toBe("Maintenance window");
    expect(programData.pausedBy).toBe("iso");
  });

  it("should resume a paused program", async () => {
    // Pause first
    await pauseProgramHandler(mockAuth, {
      programId: "builder-test",
      reason: "Testing",
    });

    // Resume
    const resumeResult = await resumeProgramHandler(mockAuth, {
      programId: "builder-test",
    });

    const resumeData = JSON.parse(resumeResult.content[0].text);
    expect(resumeData.success).toBe(true);
    expect(resumeData.paused).toBe(false);

    // Verify not paused
    const isPaused = await isProgramPaused(TEST_USER_ID, "builder-test");
    expect(isPaused).toBe(false);
  });

  it("should fail to resume a program that is not paused", async () => {
    const resumeResult = await resumeProgramHandler(mockAuth, {
      programId: "builder-test",
    });

    const resumeData = JSON.parse(resumeResult.content[0].text);
    expect(resumeData.success).toBe(false);
    expect(resumeData.error).toContain("is not paused");
  });

  it("should add governance warning when dispatching to paused program", async () => {
    // Pause the builder
    await pauseProgramHandler(mockAuth, {
      programId: "builder-test",
      reason: "Testing dispatch to paused program",
    });

    // Try to dispatch to paused program
    const dispatchResult = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Test dispatch to paused target",
      waitForUptake: false,
    });

    const dispatchData = JSON.parse(dispatchResult.content[0].text);
    expect(dispatchData.governance_warnings).toBeDefined();
    expect(dispatchData.governance_warnings).toContain(
      expect.stringContaining("[target_paused]")
    );
    expect(dispatchData.uptakeConfirmed).toBe(false);
    expect(dispatchData.success).toBe(false);
  });

  it("should allow dispatch after resuming paused program", async () => {
    // Pause and resume
    await pauseProgramHandler(mockAuth, {
      programId: "builder-test",
      reason: "Testing",
    });
    await resumeProgramHandler(mockAuth, {
      programId: "builder-test",
    });

    // Dispatch should work normally
    const dispatchResult = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Test dispatch after resume",
      waitForUptake: false,
    });

    const dispatchData = JSON.parse(dispatchResult.content[0].text);
    // Should not have paused warning
    const pausedWarning = dispatchData.governance_warnings?.find((w: string) =>
      w.includes("[target_paused]")
    );
    expect(pausedWarning).toBeUndefined();
  });
});
