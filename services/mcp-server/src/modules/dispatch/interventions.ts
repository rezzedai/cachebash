/**
 * Dispatch Interventions — Control plane actions for task management.
 *
 * Provides operator tools to intervene in live task execution:
 * - Retry failed/completed tasks
 * - Abort running tasks
 * - Reassign tasks to different programs
 * - Escalate task priority and routing
 *
 * All operations use Firestore transactions for consistency.
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../../auth/authValidator.js";
import { transition } from "../../lifecycle/engine.js";
import { z } from "zod";
import { emitEvent } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { isProgramRegistered } from "../programRegistry.js";
import { type ToolResult, jsonResult } from "./shared.js";

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

const RetryTaskSchema = z.object({
  taskId: z.string(),
  newTarget: z.string().max(100).optional(),
  newPriority: z.enum(["low", "normal", "high"]).optional(),
  reason: z.string().max(500).optional(),
});

const AbortTaskSchema = z.object({
  taskId: z.string(),
  reason: z.string().max(500),
});

const ReassignTaskSchema = z.object({
  taskId: z.string(),
  newTarget: z.string().max(100),
  reason: z.string().max(500),
});

const EscalateTaskSchema = z.object({
  taskId: z.string(),
  newPriority: z.enum(["low", "normal", "high"]).optional(),
  escalateTo: z.string().max(100).optional(),
  reason: z.string().max(500),
});

const QuarantineProgramSchema = z.object({
  programId: z.string().max(100),
  reason: z.string().max(500),
});

const UnquarantineProgramSchema = z.object({
  programId: z.string().max(100),
});

const ReplayTaskSchema = z.object({
  taskId: z.string(),
  modifiedInstructions: z.string().max(32000).optional(),
  newTarget: z.string().max(100).optional(),
  newPriority: z.enum(["low", "normal", "high"]).optional(),
  reason: z.string().max(500),
});

const ApproveTaskSchema = z.object({
  taskId: z.string(),
});

// ─── RETRY TASK ───────────────────────────────────────────────────────────────

export async function retryTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = RetryTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Validate new target if provided
  if (args.newTarget) {
    const isKnown = await isProgramRegistered(auth.userId, args.newTarget);
    if (!isKnown) {
      return jsonResult({ success: false, error: `Unknown target program: "${args.newTarget}"` });
    }
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Only retry tasks in terminal states
      if (data.status !== "done" && data.status !== "failed") {
        return { error: `Task cannot be retried (status: ${data.status}). Only done or failed tasks can be retried.` };
      }

      // Validate lifecycle transition
      transition("task", data.status, "created");

      const currentRetryCount = (data.retryCount as number) || 0;
      const newRetryCount = currentRetryCount + 1;

      const updateFields: Record<string, unknown> = {
        status: "created",
        claimedBy: null,
        claimedAt: null,
        completedAt: null,
        result: null,
        completed_status: null,
        error_code: null,
        error_class: null,
        retryCount: newRetryCount,
        lastRetriedAt: admin.firestore.FieldValue.serverTimestamp(),
        retryReason: args.reason || "manual_retry",
      };

      // Update target if provided
      if (args.newTarget) {
        updateFields.target = args.newTarget;
      }

      // Update priority if provided
      if (args.newPriority) {
        updateFields.priority = args.newPriority;
      }

      tx.update(taskRef, updateFields);

      return {
        previousStatus: data.status,
        previousTarget: data.target,
        newRetryCount,
        newTarget: args.newTarget || data.target,
        newPriority: args.newPriority || data.priority,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_RETRIED",
      program_id: auth.programId,
      task_id: args.taskId,
      previous_status: result.previousStatus as string,
      retry_count: result.newRetryCount,
      new_target: result.newTarget as string,
      reason: args.reason || "manual_retry",
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "retry_task",
      success: true,
    });

    return jsonResult({
      success: true,
      taskId: args.taskId,
      previousStatus: result.previousStatus,
      retryCount: result.newRetryCount,
      newTarget: result.newTarget,
      newPriority: result.newPriority,
      message: `Task retried (attempt ${result.newRetryCount}). Status reset to created.`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to retry task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── ABORT TASK ───────────────────────────────────────────────────────────────

export async function abortTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = AbortTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Only abort tasks that are in progress or pending
      if (data.status !== "created" && data.status !== "active") {
        return { error: `Task cannot be aborted (status: ${data.status}). Only created or active tasks can be aborted.` };
      }

      // Validate lifecycle transition: created/active -> done
      transition("task", data.status, "done");

      tx.update(taskRef, {
        status: "done",
        completed_status: "CANCELLED",
        result: args.reason,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        abortedBy: auth.programId,
        abortedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        previousStatus: data.status,
        previousTarget: data.target,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_ABORTED",
      program_id: auth.programId,
      task_id: args.taskId,
      previous_status: result.previousStatus as string,
      reason: args.reason,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "abort_task",
      success: true,
    });

    return jsonResult({
      success: true,
      taskId: args.taskId,
      previousStatus: result.previousStatus,
      message: `Task aborted. Marked as CANCELLED: ${args.reason}`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to abort task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── REASSIGN TASK ────────────────────────────────────────────────────────────

export async function reassignTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ReassignTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Validate new target
  const isKnown = await isProgramRegistered(auth.userId, args.newTarget);
  if (!isKnown && args.newTarget !== "all") {
    return jsonResult({ success: false, error: `Unknown target program: "${args.newTarget}"` });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Only reassign tasks that aren't completed
      if (data.status !== "created" && data.status !== "active") {
        return { error: `Task cannot be reassigned (status: ${data.status}). Only created or active tasks can be reassigned.` };
      }

      const updateFields: Record<string, unknown> = {
        target: args.newTarget,
        reassignedBy: auth.programId,
        reassignedAt: admin.firestore.FieldValue.serverTimestamp(),
        reassignReason: args.reason,
        previousTarget: data.target,
      };

      // If task was active, reset to created and clear claim
      if (data.status === "active") {
        transition("task", "active", "created");
        updateFields.status = "created";
        updateFields.claimedBy = null;
        updateFields.claimedAt = null;
        updateFields.sessionId = null;
        updateFields.startedAt = null;
        updateFields.lastHeartbeat = null;
      }

      tx.update(taskRef, updateFields);

      return {
        previousStatus: data.status,
        previousTarget: data.target,
        source: data.source,
        instructions: data.instructions,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_REASSIGNED",
      program_id: auth.programId,
      task_id: args.taskId,
      previous_target: result.previousTarget as string,
      new_target: args.newTarget,
      reason: args.reason,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "reassign_task",
      success: true,
    });

    return jsonResult({
      success: true,
      taskId: args.taskId,
      previousTarget: result.previousTarget,
      newTarget: args.newTarget,
      message: `Task reassigned from ${result.previousTarget} to ${args.newTarget}. ${result.previousStatus === "active" ? "Status reset to created." : ""}`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to reassign task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── ESCALATE TASK ────────────────────────────────────────────────────────────

/** Default escalation chain */
function getDefaultEscalationTarget(currentTarget: string): string | null {
  // Builder -> ISO
  if (!["iso", "orchestrator", "vector", "dispatcher", "legacy"].includes(currentTarget)) {
    return "iso";
  }
  // ISO -> VECTOR
  if (currentTarget === "iso" || currentTarget === "orchestrator") {
    return "vector";
  }
  // VECTOR -> Flynn (null = requires Flynn)
  if (currentTarget === "vector") {
    return null;
  }
  // Already at top
  return null;
}

export async function escalateTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = EscalateTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Validate escalation target if provided
  if (args.escalateTo) {
    const isKnown = await isProgramRegistered(auth.userId, args.escalateTo);
    if (!isKnown) {
      return jsonResult({ success: false, error: `Unknown escalation target: "${args.escalateTo}"` });
    }
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Don't escalate completed/archived tasks
      if (data.status === "done" || data.status === "archived") {
        return { error: `Task cannot be escalated (status: ${data.status}). Task is already completed.` };
      }

      const currentTarget = data.target as string;
      const escalationTarget = args.escalateTo || getDefaultEscalationTarget(currentTarget);

      const updateFields: Record<string, unknown> = {
        priority: args.newPriority || "high",
        escalatedBy: auth.programId,
        escalatedAt: admin.firestore.FieldValue.serverTimestamp(),
        escalationReason: args.reason,
        previousPriority: data.priority,
        previousTarget: currentTarget,
      };

      // Update target if escalation target determined
      if (escalationTarget) {
        updateFields.target = escalationTarget;

        // If task was active, reset to created
        if (data.status === "active") {
          transition("task", "active", "created");
          updateFields.status = "created";
          updateFields.claimedBy = null;
          updateFields.claimedAt = null;
          updateFields.sessionId = null;
          updateFields.startedAt = null;
          updateFields.lastHeartbeat = null;
        }
      }

      tx.update(taskRef, updateFields);

      return {
        previousPriority: data.priority,
        newPriority: args.newPriority || "high",
        previousTarget: currentTarget,
        escalatedTo: escalationTarget,
        requiresFlynn: escalationTarget === null,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_ESCALATED",
      program_id: auth.programId,
      task_id: args.taskId,
      previous_priority: result.previousPriority as string,
      new_priority: result.newPriority as string,
      previous_target: result.previousTarget as string,
      escalated_to: result.escalatedTo as string | null,
      requires_flynn: result.requiresFlynn,
      reason: args.reason,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "escalate_task",
      success: true,
    });

    const escalationMsg = result.requiresFlynn
      ? "Escalation requires Flynn approval (at top of chain)."
      : `Escalated to ${result.escalatedTo}.`;

    return jsonResult({
      success: true,
      taskId: args.taskId,
      previousPriority: result.previousPriority,
      newPriority: result.newPriority,
      escalatedTo: result.escalatedTo,
      requiresFlynn: result.requiresFlynn,
      message: `Task escalated. Priority: ${result.previousPriority} → ${result.newPriority}. ${escalationMsg}`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to escalate task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── QUARANTINE PROGRAM ──────────────────────────────────────────────────────

export async function quarantineProgramHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = QuarantineProgramSchema.parse(rawArgs);
  const db = getFirestore();
  const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);

  // Validate program exists
  const isKnown = await isProgramRegistered(auth.userId, args.programId);
  if (!isKnown) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(programRef);

      // Create or update program doc with quarantine fields
      const updateFields: Record<string, unknown> = {
        quarantined: true,
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        quarantineReason: args.reason,
        quarantinedBy: auth.programId,
      };

      tx.set(programRef, updateFields, { merge: true });

      return {
        previouslyQuarantined: doc.exists && doc.data()?.quarantined === true,
      };
    });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "PROGRAM_QUARANTINED",
      program_id: args.programId,
      quarantined_by: auth.programId,
      reason: args.reason,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "program_control",
      programId: auth.programId,
      toolName: "quarantine_program",
      success: true,
    });

    return jsonResult({
      success: true,
      programId: args.programId,
      quarantined: true,
      reason: args.reason,
      message: result.previouslyQuarantined
        ? `Program "${args.programId}" was already quarantined. Reason updated.`
        : `Program "${args.programId}" quarantined. All dispatches blocked until unquarantined.`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to quarantine program: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── UNQUARANTINE PROGRAM ────────────────────────────────────────────────────

export async function unquarantineProgramHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UnquarantineProgramSchema.parse(rawArgs);
  const db = getFirestore();
  const programRef = db.doc(`tenants/${auth.userId}/programs/${args.programId}`);

  // Validate program exists
  const isKnown = await isProgramRegistered(auth.userId, args.programId);
  if (!isKnown) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(programRef);

      if (!doc.exists || !doc.data()?.quarantined) {
        return { error: `Program "${args.programId}" is not quarantined.` };
      }

      tx.update(programRef, {
        quarantined: false,
        unquarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        unquarantinedBy: auth.programId,
        failureCount: 0,
        lastFailureAt: null,
        quarantineReason: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.delete(),
        quarantinedBy: admin.firestore.FieldValue.delete(),
      });

      return { success: true };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "PROGRAM_UNQUARANTINED",
      program_id: args.programId,
      unquarantined_by: auth.programId,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "program_control",
      programId: auth.programId,
      toolName: "unquarantine_program",
      success: true,
    });

    return jsonResult({
      success: true,
      programId: args.programId,
      quarantined: false,
      message: `Program "${args.programId}" unquarantined. Dispatch enabled.`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to unquarantine program: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── REPLAY TASK ─────────────────────────────────────────────────────────────

export async function replayTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ReplayTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const originalTaskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Validate new target if provided
  if (args.newTarget) {
    const isKnown = await isProgramRegistered(auth.userId, args.newTarget);
    if (!isKnown) {
      return jsonResult({ success: false, error: `Unknown target program: "${args.newTarget}"` });
    }
  }

  try {
    // Read original task
    const originalDoc = await originalTaskRef.get();
    if (!originalDoc.exists) {
      return jsonResult({ success: false, error: "Task not found" });
    }

    const originalData = originalDoc.data()!;

    // Clone task with modifications
    const newTaskData: Record<string, unknown> = {
      schemaVersion: originalData.schemaVersion || "2.2",
      type: originalData.type || "task",
      title: originalData.title,
      instructions: args.modifiedInstructions || originalData.instructions || "",
      preview: originalData.preview,
      source: originalData.source,
      target: args.newTarget || originalData.target,
      priority: args.newPriority || originalData.priority || "normal",
      action: originalData.action || "interrupt",
      status: "created",
      projectId: originalData.projectId || null,
      boardItemId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      encrypted: false,
      archived: false,
      ttl: originalData.ttl,
      replyTo: null,
      threadId: originalData.threadId || null,
      provenance: null,
      fallback: null,
      traceId: originalData.traceId,
      spanId: originalData.spanId,
      parentSpanId: originalData.parentSpanId,
      requires_action: true,
      auto_archived: false,
      task_class: originalData.task_class || "WORK",
      attempt_count: 0,
      // Link back to original task
      replayOf: args.taskId,
      replayReason: args.reason,
    };

    // Set TTL expiration
    const effectiveTtl = originalData.ttl as number;
    if (effectiveTtl) {
      newTaskData.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + effectiveTtl * 1000);
    }

    // Create new task
    const newTaskRef = await db.collection(`tenants/${auth.userId}/tasks`).add(newTaskData);

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_REPLAYED",
      program_id: auth.programId,
      task_id: args.taskId,
      new_task_id: newTaskRef.id,
      original_target: originalData.target as string,
      new_target: args.newTarget || originalData.target as string,
      modified_instructions: !!args.modifiedInstructions,
      reason: args.reason,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "replay_task",
      success: true,
    });

    const modifications: string[] = [];
    if (args.modifiedInstructions) modifications.push("instructions");
    if (args.newTarget) modifications.push(`target: ${originalData.target} → ${args.newTarget}`);
    if (args.newPriority) modifications.push(`priority: ${originalData.priority} → ${args.newPriority}`);

    return jsonResult({
      success: true,
      originalTaskId: args.taskId,
      newTaskId: newTaskRef.id,
      modifications: modifications.length > 0 ? modifications : ["none (exact replay)"],
      message: `Task replayed. New task created: ${newTaskRef.id}${modifications.length > 0 ? ` with modifications: ${modifications.join(", ")}` : ""}`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to replay task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ─── APPROVE TASK ────────────────────────────────────────────────────────────

export async function approveTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ApproveTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Validate task is in completing status and awaiting approval
      if (data.status !== "completing") {
        return { error: `Task cannot be approved (status: ${data.status}). Only tasks in "completing" status can be approved.` };
      }

      if (!data.awaitingApproval) {
        return { error: "Task is not awaiting approval." };
      }

      // Validate lifecycle transition: completing -> done
      transition("task", "completing", "done");

      tx.update(taskRef, {
        status: "done",
        awaitingApproval: false,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: auth.programId,
      });

      return {
        previousStatus: data.status,
        policyMode: data.policy_mode,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_APPROVED",
      program_id: auth.programId,
      task_id: args.taskId,
      policy_mode: result.policyMode as string,
    });

    emitAnalyticsEvent(auth.userId, {
      eventType: "task_intervention",
      programId: auth.programId,
      toolName: "approve_task",
      success: true,
    });

    return jsonResult({
      success: true,
      taskId: args.taskId,
      message: `Task approved. Status: completing → done.`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to approve task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
