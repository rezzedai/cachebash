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
