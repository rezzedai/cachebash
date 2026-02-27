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
  requires_action: z.boolean().optional(),
  include_archived: z.boolean().default(false),
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

const UnclaimTaskSchema = z.object({
  taskId: z.string(),
  reason: z.enum(["stale_recovery", "manual", "timeout"]).optional(),
});

const BatchClaimTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(50),
  sessionId: z.string().optional(),
});

const BatchCompleteTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(50),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  result: z.string().max(4000).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * Auto-classify whether a task requires action based on source and message_type.
 * Applied at creation time. Rules per council-ratified spec.
 */
function classifyRequiresAction(taskData: Record<string, unknown>): boolean {
  const source = taskData.source as string | undefined;
  const messageType = taskData.message_type as string | undefined;
  const completedStatus = taskData.completed_status as string | undefined;

  // Admin (Flynn) tasks always require action
  if (source === "admin") return true;

  // Classify by message_type
  switch (messageType) {
    case "DIRECTIVE": return true;
    case "QUERY": return true;
    case "HANDSHAKE": return true;
    case "ACK": return false;
    case "STATUS": return false;
    case "PING": return false;
    case "PONG": return false;
    case "RESULT":
      return completedStatus === "FAILED";
    default:
      // Plain tasks (no message_type) require action by default
      return true;
  }
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
  // Sprints are org-wide (target: null) — skip target filter for sprint types
  if (auth.programId !== "legacy" && auth.programId !== "mobile" && auth.programId !== "dispatcher"
      && args.type !== "sprint" && args.type !== "sprint-story") {
    // Program keys: only see tasks targeted at this program OR broadcast
    query = query.where("target", "in", [auth.programId, "all"]);
  }
  // Legacy/mobile keys: see everything (Flynn/mobile app)
  // If caller also provided a target filter param, apply it client-side after

  const snapshot = await query.orderBy("createdAt", "desc").limit(args.limit).get();

  // Track informational tasks for auto-archive (fire-and-forget)
  const autoArchiveRefs: admin.firestore.DocumentReference[] = [];

  const tasks = snapshot.docs
    .filter((doc) => {
      const data = doc.data();
      // Additional client-side filter if caller specified target param (for legacy keys)
      if (args.target && auth.programId === "legacy") {
        const target = data.target;
        if (target && target !== args.target) return false;
      }
      // Filter by requires_action if specified
      if (args.requires_action !== undefined) {
        const reqAction = data.requires_action ?? true; // default true for legacy tasks
        if (reqAction !== args.requires_action) return false;
      }
      // Filter out auto-archived unless explicitly included
      if (!args.include_archived && data.auto_archived === true) return false;
      // Filter out expired tasks (TTL-based auto-archive on read)
      if (data.expiresAt) {
        const expires = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
        if (expires < new Date()) return false;
      }
      return true;
    })
    .map((doc) => {
      const data = doc.data();
      const decrypted = decryptTaskFields(data, auth.encryptionKey);

      // Auto-archive informational tasks on read
      if (data.requires_action === false && !data.auto_archived) {
        autoArchiveRefs.push(doc.ref);
      }

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
        requires_action: data.requires_action ?? true,
        auto_archived: data.auto_archived || false,
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

  // Fire-and-forget: auto-archive informational tasks
  if (autoArchiveRefs.length > 0) {
    const db2 = getFirestore();
    const batch = db2.batch();
    for (const ref of autoArchiveRefs) {
      batch.update(ref, { auto_archived: true, auto_archived_at: admin.firestore.FieldValue.serverTimestamp() });
    }
    batch.commit().catch((err: unknown) => console.error("[AutoArchive] Failed:", err));
  }

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
    boardItemId: args.boardItemId || null,
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

    // Auto-classification: requires_action
    taskData.requires_action = classifyRequiresAction(taskData);
    taskData.auto_archived = false;

    // Telemetry: classify task
    taskData.task_class = classifyTask(args.type, args.action, args.title);
    taskData.attempt_count = 0;

  // Default 24h TTL for type=task; other types (dream, sprint, question) have no default TTL
  const DEFAULT_TASK_TTL_S = 24 * 60 * 60;
  const effectiveTtl = args.ttl || (args.type === "task" ? DEFAULT_TASK_TTL_S : null);
  if (effectiveTtl) {
    taskData.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + effectiveTtl * 1000);
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
      const isAdmin = auth.programId === "legacy";
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

        tx.update(taskRef, {
          status: "active",
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          sessionId: args.sessionId || null,
          lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
          attempt_count: admin.firestore.FieldValue.increment(1),
        });

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

export async function batchCompleteTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = BatchCompleteTasksSchema.parse(rawArgs);
  const db = getFirestore();

  // Soft telemetry validation
  const missingFields: string[] = [];
  if (!args.model) missingFields.push("model");
  if (!args.provider) missingFields.push("provider");
  if (missingFields.length > 0) {
    db.collection(`tenants/${auth.userId}/telemetryGaps`).add({
      taskIds: args.taskIds,
      programId: auth.programId,
      missingFields,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err: unknown) => console.error("[Telemetry] Failed to log gap:", err));
  }

  const results: Array<{ taskId: string; success: boolean; error?: string }> = [];

  for (const taskId of args.taskIds) {
    const taskRef = db.doc(`tenants/${auth.userId}/tasks/${taskId}`);
    try {
      let taskData: { instructions?: string; source?: string; target?: string; dreamId?: string } = {};

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        if (!doc.exists) throw new Error("Task not found");

        const data = doc.data()!;
        const current = data.status as LifecycleStatus;
        taskData = { instructions: data.instructions, source: data.source, target: data.target, dreamId: data.dreamId };

        const lifecycleTarget = args.completed_status === "FAILED" ? "failed" : "done";
        transition("task", current, lifecycleTarget as LifecycleStatus);

        const updateFields: Record<string, unknown> = {
          status: args.completed_status === "FAILED" ? "failed" : "done",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastHeartbeat: null,
          completed_status: args.completed_status,
        };
        if (args.result) updateFields.result = args.result;
        if (args.model) updateFields.model = args.model;
        if (args.provider) updateFields.provider = args.provider;

        tx.update(taskRef, updateFields);
      });

      // Fire-and-forget: sync + telemetry per task
      syncTaskCompleted(auth.userId, taskId);

      emitEvent(auth.userId, {
        event_type: args.completed_status === "FAILED" ? "TASK_FAILED" : "TASK_SUCCEEDED",
        program_id: auth.programId,
        task_id: taskId,
        model: args.model,
        prompt_hash: taskData.instructions ? computeHash(taskData.instructions) : undefined,
        config_hash: taskData.source ? computeHash(`${taskData.source}:${taskData.target}:${args.model}`) : undefined,
      });

      emitAnalyticsEvent(auth.userId, {
        eventType: "task_lifecycle",
        programId: auth.programId,
        toolName: "batch_complete_tasks",
        success: args.completed_status !== "FAILED",
      });

      // Budget tracking per task
      if (taskData.dreamId) {
        try {
          const budgetCheck = await checkDreamBudget(auth.userId, taskData.dreamId);
          if (!budgetCheck.withinBudget) {
            emitEvent(auth.userId, {
              event_type: "BUDGET_EXCEEDED",
              program_id: auth.programId,
              task_id: taskId,
            });
          }
        } catch { /* budget check is best-effort */ }
      }

      results.push({ taskId, success: true });
    } catch (error) {
      results.push({ taskId, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const completed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return jsonResult({ success: true, results, completed, failed });
}

// === Story 2D: Claim Contention Telemetry ===

const CLAIM_EVENT_TTL_DAYS = 7;

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
    Date.now() + CLAIM_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000,
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

const GetContentionMetricsSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

function claimPeriodStart(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this_week": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case "this_month": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d;
    }
    case "all":
      return null;
    default:
      return null;
  }
}

export async function getContentionMetricsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetContentionMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();

  const start = claimPeriodStart(args.period);

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/claim_events`);
  if (start) {
    query = query.where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start));
  }

  const snapshot = await query.get();

  let claimsAttempted = 0;
  let claimsWon = 0;
  let contentionEvents = 0;

  // For mean time to claim: collect taskIds from claimed events, then compute average
  const claimedTaskIds: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    claimsAttempted++;

    if (data.outcome === "claimed") {
      claimsWon++;
      if (data.taskId) claimedTaskIds.push(data.taskId as string);
    } else if (data.outcome === "contention") {
      contentionEvents++;
    }
  }

  // Compute mean time to claim: for each claimed task, find task createdAt vs claim event timestamp
  let meanTimeToClaimMs: number | null = null;
  if (claimedTaskIds.length > 0) {
    // Batch-fetch task docs to get createdAt timestamps
    const uniqueTaskIds = [...new Set(claimedTaskIds)].slice(0, 100); // cap at 100 lookups
    let totalClaimLatencyMs = 0;
    let latencySamples = 0;

    // Fetch tasks in batches of 10 (Firestore getAll limit per call is reasonable)
    const taskRefs = uniqueTaskIds.map((id) => db.doc(`tenants/${auth.userId}/tasks/${id}`));
    const taskDocs = await db.getAll(...taskRefs);

    const taskCreatedMap = new Map<string, number>();
    for (const taskDoc of taskDocs) {
      if (taskDoc.exists) {
        const data = taskDoc.data()!;
        const createdAt = data.createdAt?.toDate?.()?.getTime();
        if (createdAt) taskCreatedMap.set(taskDoc.id, createdAt);
      }
    }

    // Match claim events with their task's createdAt
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.outcome === "claimed" && data.taskId && data.timestamp) {
        const taskCreatedMs = taskCreatedMap.get(data.taskId as string);
        const claimTimestamp = data.timestamp?.toDate?.()?.getTime();
        if (taskCreatedMs && claimTimestamp && claimTimestamp > taskCreatedMs) {
          totalClaimLatencyMs += claimTimestamp - taskCreatedMs;
          latencySamples++;
        }
      }
    }

    if (latencySamples > 0) {
      meanTimeToClaimMs = Math.round(totalClaimLatencyMs / latencySamples);
    }
  }

  return jsonResult({
    success: true,
    period: args.period,
    claimsAttempted,
    claimsWon,
    contentionEvents,
    contentionRate: claimsAttempted > 0
      ? Math.round((contentionEvents / claimsAttempted) * 10000) / 100
      : 0,
    meanTimeToClaimMs,
  });
}
