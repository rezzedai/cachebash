/**
 * Dispatch Module — Task CRUD.
 * Collection: users/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { decrypt, isEncrypted } from "../encryption/crypto.js";
import { transition, type LifecycleStatus } from "../lifecycle/engine.js";
import { z } from "zod";
import { isGridProgram, isValidProgram, GRID_PROGRAMS, isGroupTarget, resolveCapability } from "../config/programs.js";

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
  ttl: z.number().positive().optional(),
  replyTo: z.string().optional(),
  threadId: z.string().optional(),
  provenance: z.object({
    model: z.string().optional(),
    cost_tokens: z.number().optional(),
    confidence: z.number().optional(),
  }).optional(),
  fallback: z.array(z.string()).optional(),
});

const ClaimTaskSchema = z.object({
  taskId: z.string(),
  sessionId: z.string().optional(),
});

const CompleteTaskSchema = z.object({
  taskId: z.string(),
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

  let query: admin.firestore.Query = db.collection(`users/${auth.userId}/tasks`);

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

  // Capability-based routing: resolve "cap:xxx" targets to program IDs
  if (args.target.startsWith('cap:')) {
    const capability = args.target.slice(4);
    const resolved = resolveCapability(capability);
    if (!resolved) {
      return jsonResult({
        success: false,
        error: `No program has capability: "${capability}". Use GET /v1/programs to see available capabilities.`,
      });
    }
    args.target = resolved;
  }

  // Phase 2: Validate target is a known program or group
  if (args.target !== "all" && !isValidProgram(args.target) && !isGridProgram(args.target) && !isGroupTarget(args.target)) {
    return jsonResult({ success: false, error: `Unknown target program: "${args.target}". Use a valid program ID or "all" for broadcast.` });
  }

  const db = getFirestore();

  const preview = args.title.length > 50 ? args.title.substring(0, 47) + "..." : args.title;
  const now = serverTimestamp();

  const taskData: Record<string, unknown> = {
    type: args.type,
    title: args.title,
    instructions: args.instructions || "",
    preview,
    source: args.source || "unknown",
    target: args.target,
    priority: args.priority,
    action: args.action,
    status: "created",
    projectId: args.projectId || null,
    createdAt: now,
    encrypted: false,
    archived: false,
    // Envelope v2.1
    ttl: args.ttl || null,
    replyTo: args.replyTo || null,
    threadId: args.threadId || null,
    provenance: args.provenance || null,
    fallback: args.fallback || null,
  };

  if (args.ttl) {
    // expiresAt computed by Cloud Function on write, or we estimate here
    taskData.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + args.ttl * 1000);
  }

  const ref = await db.collection(`users/${auth.userId}/tasks`).add(taskData);

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
  const taskRef = db.doc(`users/${auth.userId}/tasks/${args.taskId}`);

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
      });

      return { data };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

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
  const taskRef = db.doc(`users/${auth.userId}/tasks/${args.taskId}`);

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) throw new Error("Task not found");

      const data = doc.data()!;
      const current = data.status as LifecycleStatus;

      // Validate transition — active → done
      transition("task", current, "done");

      tx.update(taskRef, {
        status: "done",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: null,
      });
    });

    return jsonResult({ success: true, taskId: args.taskId, message: "Task marked as done" });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to complete task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
