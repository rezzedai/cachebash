/**
 * Dispatch Module — Task CRUD (get_tasks, create_task).
 * Collection: tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { verifySource } from "../../middleware/gate.js";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import { isGroupTarget } from "../../config/programs.js";
import { isProgramRegistered } from "../programRegistry.js";
import { syncTaskCreated } from "../github-sync.js";
import { emitEvent, classifyTask, type TaskClass } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { generateSpanId } from "../../utils/trace.js";
import { notifyDispatcher } from "../../webhooks/dispatcher-notify.js";
import { type ToolResult, jsonResult, decryptTaskFields } from "./shared.js";

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
        // Completion fields (populated after complete_task)
        result: data.result || null,
        completed_status: data.completed_status || null,
        completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
        claimedBy: data.claimedBy || null,
        claimedAt: data.claimedAt?.toDate?.()?.toISOString() || null,
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
  if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {
    const isKnown = await isProgramRegistered(auth.userId, args.target);
    if (!isKnown) {
      return jsonResult({ success: false, error: `Unknown target program: "${args.target}". Use a valid program ID, group name, or @role for role-based targeting.` });
    }
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

  // Fire-and-forget: notify Grid Dispatcher via webhook
  notifyDispatcher({
    taskId: ref.id,
    target: args.target,
    priority: args.priority || 'normal',
    title: args.title,
    timestamp: new Date().toISOString(),
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

export async function getTaskByIdHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = z.object({ taskId: z.string() }).parse(rawArgs);
  const db = getFirestore();
  const doc = await db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`).get();

  if (!doc.exists) {
    return jsonResult({ success: false, error: "Task not found" });
  }

  const data = doc.data()!;
  const decrypted = decryptTaskFields(data, auth.encryptionKey);

  return jsonResult({
    success: true,
    task: {
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
      ttl: data.ttl || null,
      replyTo: data.replyTo || null,
      threadId: data.threadId || null,
      provenance: data.provenance || null,
      fallback: data.fallback || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      result: data.result || null,
      completed_status: data.completed_status || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
      claimedBy: data.claimedBy || null,
      claimedAt: data.claimedAt?.toDate?.()?.toISOString() || null,
    },
  });
}
