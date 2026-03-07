/**
 * Dispatch Module — Claim operations (claim_task, unclaim_task, batch_claim).
 * Collection: tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../../auth/authValidator.js";
import { transition } from "../../lifecycle/engine.js";
import { z } from "zod";
import { syncTaskClaimed } from "../github-sync.js";
import { emitEvent } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { type ToolResult, jsonResult, decryptTaskFields } from "./shared.js";
import { CONSTANTS } from "../../config/constants.js";

const ClaimTaskSchema = z.object({
  taskId: z.string(),
  sessionId: z.string().optional(),
});

const UnclaimTaskSchema = z.object({
  taskId: z.string(),
  reason: z.enum(["stale_recovery", "manual", "timeout"]).optional(),
});

const BatchClaimTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(CONSTANTS.limits.batchClaimMax),
  sessionId: z.string().optional(),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

/**
 * Fire-and-forget: emit a claim event to the claim_events collection.
 * Called on every claim attempt (success or contention).
 */
function emitClaimEvent(
  db: admin.firestore.Firestore,
  userId: string,
  taskId: string,
  sessionId: string,
  outcome: "claimed" | "contention",
): void {
  const ttl = admin.firestore.Timestamp.fromMillis(
    Date.now() + CONSTANTS.ttl.claimEventDays * 24 * 60 * 60 * 1000,
  );
  db.collection(`tenants/${userId}/claim_events`).add({
    taskId,
    sessionId,
    outcome,
    timestamp: serverTimestamp(),
    ttl,
  }).catch((err) => {
    console.error("[ClaimTelemetry] Failed to write claim event:", err);
  });
}

export async function claimTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ClaimTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      // Idempotent: already claimed by this session
      if (data.status === "active" && data.sessionId === args.sessionId) {
        return { alreadyClaimed: true, data };
      }

      if (data.status !== "created") {
        return { contention: true, error: `Task not claimable (status: ${data.status})`, data };
      }

      // Validate lifecycle transition
      transition("task", "created", "active");

      tx.update(taskRef, {
        status: "active",
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: args.sessionId || null,
        lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
        attempt_count: admin.firestore.FieldValue.increment(1),
      });

      return { data };
    });

    if ("error" in result) {
      // Story 2D: Emit contention claim event (fire-and-forget)
      if (result.contention) {
        emitClaimEvent(db, auth.userId, args.taskId, args.sessionId || auth.programId, "contention");
      }
      return jsonResult({ success: false, error: result.error });
    }

    // Fire-and-forget: sync claim to GitHub Project board (outside transaction)
    if (!result.alreadyClaimed) {
      syncTaskClaimed(auth.userId, args.taskId);
    }

    // Emit telemetry event
    if (!result.alreadyClaimed) {
      emitEvent(auth.userId, {
        event_type: "TASK_CLAIMED",
        program_id: auth.programId,
        session_id: args.sessionId || undefined,
        task_id: args.taskId,
      });

      // Analytics: task_lifecycle claim
      emitAnalyticsEvent(auth.userId, {
        eventType: "task_lifecycle",
        programId: auth.programId,
        sessionId: args.sessionId,
        toolName: "claim_task",
        taskType: result.data!.type as string,
        priority: result.data!.priority as string,
        action: result.data!.action as string,
        success: true,
      });

      // Story 2D: Emit successful claim event (fire-and-forget)
      emitClaimEvent(db, auth.userId, args.taskId, args.sessionId || auth.programId, "claimed");
    }

    const decrypted = decryptTaskFields(result.data!, auth.encryptionKey);
    return jsonResult({
      success: true,
      taskId: args.taskId,
      title: decrypted.title,
      instructions: decrypted.instructions,
      action: result.data!.action || "queue",
      priority: result.data!.priority || "normal",
      alreadyClaimed: result.alreadyClaimed || false,
      message: result.alreadyClaimed ? "Task already claimed by this session." : "Task claimed.",
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to claim task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function unclaimTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UnclaimTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) return { error: "Task not found" };

      const data = doc.data()!;

      if (data.status !== "active") {
        return { error: `Task not unclaimable (status: ${data.status}). Only active tasks can be unclaimed.` };
      }

      // Authorization: callable by the claiming session, any program with 'iso' identity, or admin/legacy key
      const claimingSession = data.sessionId as string | undefined;
      const isClaimingSession = claimingSession && claimingSession === auth.programId;
      const isIso = auth.programId === "iso" || auth.programId === "orchestrator";
      const isAdmin = auth.programId === "legacy" || auth.programId === "dispatcher";
      if (!isClaimingSession && !isIso && !isAdmin) {
        return { error: `Unauthorized: only the claiming session, ISO, or admin can unclaim this task.` };
      }

      // Validate lifecycle transition: active -> created
      transition("task", "active", "created");

      // Compute new unclaimCount
      const currentUnclaimCount = (data.unclaimCount as number) || 0;
      const newUnclaimCount = currentUnclaimCount + 1;

      const updateFields: Record<string, unknown> = {
        status: "created",
        sessionId: null,
        startedAt: null,
        lastHeartbeat: null,
        unclaimCount: newUnclaimCount,
        lastUnclaimedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUnclaimReason: args.reason || "manual",
      };

      // Circuit breaker: flag task for manual review at 3+ unclaims
      if (newUnclaimCount >= 3) {
        updateFields.requires_action = true;
        updateFields.flagged = true;
      }

      tx.update(taskRef, updateFields);

      return {
        data,
        newUnclaimCount,
        flagged: newUnclaimCount >= 3,
      };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    // Emit telemetry event
    emitEvent(auth.userId, {
      event_type: "TASK_UNCLAIMED",
      program_id: auth.programId,
      task_id: args.taskId,
      reason: args.reason || "manual",
      unclaim_count: result.newUnclaimCount,
      flagged: result.flagged,
    });

    // Analytics: task_lifecycle unclaim
    emitAnalyticsEvent(auth.userId, {
      eventType: "task_lifecycle",
      programId: auth.programId,
      toolName: "unclaim_task",
      taskType: result.data!.type as string,
      priority: result.data!.priority as string,
      action: result.data!.action as string,
      success: true,
    });

    return jsonResult({
      success: true,
      taskId: args.taskId,
      unclaimCount: result.newUnclaimCount,
      flagged: result.flagged || false,
      message: result.flagged
        ? "Task unclaimed and flagged for manual review (3+ unclaims)."
        : "Task unclaimed and re-queued.",
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to unclaim task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function batchClaimTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = BatchClaimTasksSchema.parse(rawArgs);
  const db = getFirestore();

  const results: Array<{ taskId: string; success: boolean; error?: string; title?: string }> = [];

  for (const taskId of args.taskIds) {
    const taskRef = db.doc(`tenants/${auth.userId}/tasks/${taskId}`);
    try {
      const txResult = await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        if (!doc.exists) return { error: "Task not found" };

        const data = doc.data()!;

        // Idempotent: already claimed by this session
        if (data.status === "active" && data.sessionId === args.sessionId) {
          return { alreadyClaimed: true, data };
        }

        if (data.status !== "created") {
          return { error: `Task not claimable (status: ${data.status})` };
        }

        transition("task", "created", "active");

        const claimUpdate: Record<string, unknown> = {
          status: "active",
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          sessionId: args.sessionId || null,
          lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
          attempt_count: admin.firestore.FieldValue.increment(1),
        };
        // Agent Trace L2: propagate trace context on batch claim
        if (args.traceId) claimUpdate.traceId = args.traceId;
        if (args.spanId) claimUpdate.claimSpanId = args.spanId;
        if (args.parentSpanId) claimUpdate.claimParentSpanId = args.parentSpanId;
        tx.update(taskRef, claimUpdate);

        return { data };
      });

      if ("error" in txResult) {
        results.push({ taskId, success: false, error: txResult.error as string });
        continue;
      }

      // Fire-and-forget: sync + telemetry per task
      if (!txResult.alreadyClaimed) {
        syncTaskClaimed(auth.userId, taskId);
        emitEvent(auth.userId, {
          event_type: "TASK_CLAIMED",
          program_id: auth.programId,
          session_id: args.sessionId || undefined,
          task_id: taskId,
        });
        emitAnalyticsEvent(auth.userId, {
          eventType: "task_lifecycle",
          programId: auth.programId,
          sessionId: args.sessionId,
          toolName: "batch_claim_tasks",
          taskType: txResult.data!.type as string,
          priority: txResult.data!.priority as string,
          action: txResult.data!.action as string,
          success: true,
        });
      }

      const decrypted = decryptTaskFields(txResult.data!, auth.encryptionKey);
      results.push({ taskId, success: true, title: decrypted.title });
    } catch (error) {
      results.push({ taskId, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const claimed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return jsonResult({ success: true, results, claimed, failed });
}
