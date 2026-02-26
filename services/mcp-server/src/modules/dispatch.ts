/**
 * Dispatch Module — Task CRUD.
 * Collection: tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { verifySource } from "../middleware/gate.js";
import { AuthContext } from "../auth/authValidator.js";
import { decrypt, isEncrypted } from "../encryption/crypto.js";
import { transition, type LifecycleStatus } from "../lifecycle/engine.js";
import { z } from "zod";
import { isRegisteredProgram, isValidProgram, REGISTERED_PROGRAMS, isGroupTarget } from "../config/programs.js";
import { syncTaskCreated, syncTaskClaimed, syncTaskCompleted } from "./github-sync.js";
import { emitEvent, classifyTask, computeHash, type CompletedStatus, type ErrorClass, type TaskClass } from "./events.js";
import { emitAnalyticsEvent } from "./analytics.js";
import { checkDreamBudget, updateDreamConsumption } from "./budget.js";
import { generateSpanId } from "../utils/trace.js";
const GetTasksSchema = z.object({
  status: z.enum(["created", "active", "all"]).default("created"),
  type: z.enum(["task", "question", "dream", "sprint", "sprint-story", "all"]).default("all"),
  target: z.string().max(100).optional(),
  limit: z.number().min(1).max(50).default(10),
});

const CreateTaskSchema = z.object({
  title: z.string().max(200),
  instructions: z.string().max(4000).optional(),
  type: z.enum(["task", "question", "dream", "sprint", "sprint-story"]).default("task"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  action: z.enum(["interrupt", "sprint", "parallel", "queue", "backlog"]).default("queue"),
  source: z.string().max(100).optional(),
  target: z.string().max(100),
  projectId: z.string().optional(),
  boardItemId: z.string().optional(),
  ttl: z.number().positive().optional(),
  replyTo: z.string().optional(),
  threadId: z.string().optional(),
  provenance: z.object({
    model: z.string().optional(),
    cost_tokens: z.number().optional(),
    confidence: z.number().optional(),
  }).optional(),
  fallback: z.array(z.string()).optional(),
  // Agent Trace L1
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const ClaimTaskSchema = z.object({
  taskId: z.string(),
  sessionId: z.string().optional(),
});

const CompleteTaskSchema = z.object({
  taskId: z.string(),
  tokens_in: z.number().nonnegative().optional(),
  tokens_out: z.number().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  model: z.string().optional(),
  provider: z.string().optional(),
  result: z.string().max(4000).optional(),
  error_code: z.string().optional(),
  error_class: z.enum(["TRANSIENT", "PERMANENT", "DEPENDENCY", "POLICY", "TIMEOUT", "UNKNOWN"]).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function decryptTaskFields(
  data: { title?: string; instructions?: string; encrypted?: boolean },
  key: Buffer
): { title: string; instructions: string } {
  if (!data.encrypted) {
    return { title: data.title || "", instructions: data.instructions || "" };
  }
  try {
    return {
      title: data.title && isEncrypted(data.title) ? decrypt(data.title, key) : data.title || "",
      instructions: data.instructions && isEncrypted(data.instructions)
        ? decrypt(data.instructions, key) : data.instructions || "",
    };
  } catch {
    return { title: data.title || "", instructions: data.instructions || "" };
  }
}

export async function getTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetTasksSchema.parse(rawArgs);
  const db = getFirestore();

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`);

  if (args.status !== "all") {
    query = query.where("status", "==", args.status);
  }
  if (args.type !== "all") {
    query = query.where("type", "==", args.type);
  }

  // Phase 2: Target enforcement — programs only see their own tasks
  if (auth.programId !== "legacy" && auth.programId !== "mobile") {
    // Program keys: only see tasks targeted at this program OR broadcast
    query = query.where("target", "in", [auth.programId, "all"]);
  }
  // Legacy/mobile keys: see everything (Flynn/mobile app)
  // If caller also provided a target filter param, apply it client-side after

  const snapshot = await query.orderBy("createdAt", "desc").limit(args.limit).get();

  const tasks = snapshot.docs
    .filter((doc) => {
      // Additional client-side filter if caller specified target param (for legacy keys)
      if (args.target && auth.programId === "legacy") {
        const target = doc.data().target;
        return !target || target === args.target;
      }
      return true;
    })
    .map((doc) => {
      const data = doc.data();
      const decrypted = decryptTaskFields(data, auth.encryptionKey);
      return {
        id: doc.id,
        type: data.type || "task",
        title: decrypted.title,
        instructions: decrypted.instructions,
        action: data.action || "queue",
        priority: data.priority || "normal",
        status: data.status,
        source: data.source,
        target: data.target,
        projectId: data.projectId || null,
        // Envelope v2.1
        ttl: data.ttl || null,
        replyTo: data.replyTo || null,
        threadId: data.threadId || null,
        provenance: data.provenance || null,
        fallback: data.fallback || null,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

  return jsonResult({
    success: true,
    hasTasks: tasks.length > 0,
    count: tasks.length,
    tasks,
    message: tasks.length > 0 ? `Found ${tasks.length} task(s)` : "No tasks found",
  });
}

export async function createTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateTaskSchema.parse(rawArgs);

  // Phase 2: Enforce source identity
  const verifiedSource = verifySource(args.source, auth, "mcp");

  // Phase 2: Validate target is a known program or group
  if (args.target !== "all" && !isValidProgram(args.target) && !isRegisteredProgram(args.target) && !isGroupTarget(args.target)) {
    return jsonResult({ success: false, error: `Unknown target program: "${args.target}". Use a valid program ID or "all" for broadcast.` });
  }

  const db = getFirestore();

  const preview = args.title.length > 50 ? args.title.substring(0, 47) + "..." : args.title;
  const now = serverTimestamp();

  const taskData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    type: args.type,
    title: args.title,
    instructions: args.instructions || "",
    preview,
    source: verifiedSource,
    target: args.target,
    priority: args.priority,
    action: args.action,
    status: "created",
    projectId: args.projectId || null,
    boardItemId: args.boardItemId || undefined,
    createdAt: now,
    encrypted: false,
    archived: false,
    // Envelope v2.1
    ttl: args.ttl || null,
    replyTo: args.replyTo || null,
    threadId: args.threadId || null,
    provenance: args.provenance || null,
    fallback: args.fallback || null,
    // Agent Trace L1
    traceId: args.traceId || null,
    spanId: args.spanId || generateSpanId(),
    parentSpanId: args.parentSpanId || null,
  };

    // Telemetry: classify task
    taskData.task_class = classifyTask(args.type, args.action, args.title);
    taskData.attempt_count = 0;

  if (args.ttl) {
    // expiresAt computed by Cloud Function on write, or we estimate here
    taskData.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + args.ttl * 1000);
  }

  const ref = await db.collection(`tenants/${auth.userId}/tasks`).add(taskData);

  // Emit telemetry event
  emitEvent(auth.userId, {
    event_type: "TASK_CREATED",
    program_id: verifiedSource,
    task_id: ref.id,
    task_class: taskData.task_class as TaskClass,
    target: args.target,
    type: args.type,
    priority: args.priority,
    action: args.action,
  });

  // Analytics: task_lifecycle create
  emitAnalyticsEvent(auth.userId, {
    eventType: "task_lifecycle",
    programId: verifiedSource,
    toolName: "create_task",
    taskType: args.type,
    priority: args.priority,
    action: args.action,
    success: true,
  });

  // Fire-and-forget: sync to GitHub Issues + Project board
  syncTaskCreated(
    auth.userId,
    ref.id,
    args.title,
    args.instructions || "",
    args.action,
    args.priority,
    args.projectId,
    args.type,
    args.boardItemId
  );

  return jsonResult({
    success: true,
    taskId: ref.id,
    title: args.title,
    action: args.action,
    message: `Task created. ID: "${ref.id}"`,
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
        return { error: `Task not claimable (status: ${data.status})` };
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

    if ("error" in result) return jsonResult({ success: false, error: result.error });

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

export async function completeTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CompleteTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Soft telemetry validation — log gaps, never block completion
  const missingFields: string[] = [];
  if (!args.model) missingFields.push("model");
  if (!args.provider) missingFields.push("provider");
  if (!args.completed_status) missingFields.push("completed_status");
  if (!args.result) missingFields.push("result");
  if (missingFields.length > 0) {
    db.collection(`tenants/${auth.userId}/telemetryGaps`).add({
      taskId: args.taskId,
      programId: auth.programId,
      missingFields,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.error("[Telemetry] Failed to log gap:", err));
  }

  // Capture task data for provenance hashing and budget tracking
  let taskData: { 
    instructions?: string; 
    source?: string; 
    target?: string;
    dreamId?: string;
    sprintParentId?: string;
  } = {};

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) throw new Error("Task not found");

      const data = doc.data()!;
      const current = data.status as LifecycleStatus;

      // Capture task data for provenance hashing and budget tracking (before transaction completes)
      taskData = {
        instructions: data.instructions as string | undefined,
        source: data.source as string | undefined,
        target: data.target as string | undefined,
        dreamId: data.dreamId as string | undefined,
        sprintParentId: data.sprint?.parentId as string | undefined,
      };

      // Determine lifecycle target based on completed_status
      const lifecycleTarget = args.completed_status === "FAILED" ? "failed" : "done";
      transition("task", current, lifecycleTarget as LifecycleStatus);

      const updateFields: Record<string, unknown> = {
        status: args.completed_status === "FAILED" ? "failed" : "done",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: null,
        completed_status: args.completed_status,
      };
      if (args.tokens_in !== undefined) updateFields.tokens_in = args.tokens_in;
      if (args.tokens_out !== undefined) updateFields.tokens_out = args.tokens_out;
      if (args.cost_usd !== undefined) updateFields.cost_usd = args.cost_usd;
      if (args.model) updateFields.model = args.model;
      if (args.provider) updateFields.provider = args.provider;
      if (args.result) updateFields.result = args.result;
      if (args.error_code) updateFields.last_error_code = args.error_code;
      if (args.error_class) updateFields.last_error_class = args.error_class;
      tx.update(taskRef, updateFields);
    });

    // Fire-and-forget: sync completion to GitHub (outside transaction)
    syncTaskCompleted(auth.userId, args.taskId);

    // Budget tracking: update dream consumption if task belongs to a dream and has cost
    if (args.cost_usd && args.cost_usd > 0) {
      let dreamId: string | undefined;
      
      // Check if task directly has dreamId
      if (taskData.dreamId) {
        dreamId = taskData.dreamId;
      }
      // Check if task is a sprint story that belongs to a dream sprint
      else if (taskData.sprintParentId) {
        try {
          const sprintDoc = await db.doc(`tenants/${auth.userId}/tasks/${taskData.sprintParentId}`).get();
          if (sprintDoc.exists) {
            const sprintData = sprintDoc.data()!;
            dreamId = sprintData.dreamId as string | undefined;
          }
        } catch (err) {
          console.error("[Budget] Failed to check sprint parent for dream context:", err);
        }
      }

      // If we found a dream context, track the cost
      if (dreamId) {
        try {
          // Update dream consumption atomically
          await updateDreamConsumption(auth.userId, dreamId, args.cost_usd);
          
          // Check if budget exceeded
          const budgetCheck = await checkDreamBudget(auth.userId, dreamId);
          
          if (!budgetCheck.withinBudget) {
            // Emit BUDGET_EXCEEDED event
            emitEvent(auth.userId, {
              event_type: "BUDGET_EXCEEDED",
              program_id: auth.programId,
              task_id: dreamId,
              consumed: budgetCheck.consumed,
              cap: budgetCheck.cap,
              remaining: budgetCheck.remaining,
            });

            // Send alert to Flynn (fire-and-forget)
            const alertMessage = `Dream ${dreamId} has exceeded its budget cap.

Consumed: $${budgetCheck.consumed.toFixed(4)}
Cap: $${budgetCheck.cap.toFixed(4)}
Overage: $${(budgetCheck.consumed - budgetCheck.cap).toFixed(4)}`;
            
            db.collection(`tenants/${auth.userId}/relay`).add({
              schemaVersion: '2.2' as const,
              source: "system",
              target: "user",
              message_type: "STATUS",
              payload: alertMessage,
              priority: "high",
              action: "queue",
              sessionId: null,
              status: "pending",
              ttl: 3600,
              expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600 * 1000),
              alertType: "BUDGET_EXCEEDED",
              context: { dreamId, consumed: budgetCheck.consumed, cap: budgetCheck.cap },
              createdAt: serverTimestamp(),
            }).catch((err) => console.error("[Budget] Failed to send alert:", err));
          }
        } catch (err) {
          console.error("[Budget] Failed to track dream budget:", err);
          // Don't fail the task completion if budget tracking fails
        }
      }
    }

    // Emit telemetry event with cryptographic provenance
    emitEvent(auth.userId, {
      event_type: args.completed_status === "FAILED" ? "TASK_FAILED" : "TASK_SUCCEEDED",
      program_id: auth.programId,
      task_id: args.taskId,
      completed_status: args.completed_status,
      tokens_in: args.tokens_in,
      tokens_out: args.tokens_out,
      cost_usd: args.cost_usd,
      model: args.model,
      provider: args.provider,
      error_code: args.error_code,
      error_class: args.error_class,
      prompt_hash: taskData.instructions ? computeHash(taskData.instructions) : undefined,
      config_hash: taskData.source ? computeHash(`${taskData.source}:${taskData.target}:${args.model || "unknown"}`) : undefined,
    });

    // Analytics: task_lifecycle complete
    emitAnalyticsEvent(auth.userId, {
      eventType: "task_lifecycle",
      programId: auth.programId,
      toolName: "complete_task",
      success: args.completed_status !== "FAILED",
      errorCode: args.error_code,
      errorClass: args.error_class,
    });

    return jsonResult({ success: true, taskId: args.taskId, message: "Task marked as done" });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to complete task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

