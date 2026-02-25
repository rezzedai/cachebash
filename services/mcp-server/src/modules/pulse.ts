/**
 * Pulse Module — Session CRUD + heartbeat.
 * Collection: tenants/{uid}/sessions
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { transition, type LifecycleStatus } from "../lifecycle/engine.js";
import { z } from "zod";
import { PROGRAM_REGISTRY } from "../config/programs.js";
import { emitAnalyticsEvent } from "./analytics.js";

const CreateSessionSchema = z.object({
  name: z.string().max(200),
  sessionId: z.string().max(100).optional(),
  programId: z.string().max(50).optional(),
  status: z.string().max(200).optional(),
  state: z.enum(["working", "blocked", "complete", "pinned"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  projectName: z.string().max(100).optional(),
});

const UpdateSessionSchema = z.object({
  status: z.string().max(200),
  sessionId: z.string().max(100).optional(),
  state: z.enum(["working", "blocked", "complete", "pinned"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  projectName: z.string().max(100).optional(),
  lastHeartbeat: z.boolean().optional(), // When true, also update heartbeat timestamp
  contextBytes: z.number().min(0).optional(),
  handoffRequired: z.boolean().optional(),
});

const ListSessionsSchema = z.object({
  state: z.enum(["working", "blocked", "pinned", "complete", "all"]).default("all"),
  programId: z.string().max(50).optional(),
  limit: z.number().min(1).max(50).default(10),
  includeArchived: z.boolean().default(false),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Map v1 state names to lifecycle status */
function stateToLifecycle(state: string): LifecycleStatus {
  switch (state) {
    case "working": return "active";
    case "blocked": return "blocked";
    case "complete": return "done";
    case "pinned": return "blocked";
    default: return "active";
  }
}

export async function createSessionHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateSessionSchema.parse(rawArgs);
  const db = getFirestore();

  const sessionId = args.sessionId || `session_${Date.now()}`;
  const programId = args.programId || sessionId.split(".")[0];
  const now = serverTimestamp();
  const lifecycleStatus = stateToLifecycle(args.state || "working");

  const sessionData: Record<string, unknown> = {
    name: args.name,
    programId,
    status: lifecycleStatus,
    currentAction: args.status || args.name,
    progress: args.progress ?? null,
    projectName: args.projectName || null,
    lastUpdate: now,
    createdAt: now,
    lastHeartbeat: now,
    archived: false,
  };

  await db.doc(`tenants/${auth.userId}/sessions/${sessionId}`).set(sessionData);

  // Add initial update to history
  await db.collection(`tenants/${auth.userId}/sessions/${sessionId}/updates`).add({
    status: args.status || args.name,
    lifecycleStatus,
    progress: args.progress ?? null,
    createdAt: now,
  });

  // Piggyback program registry write
  if (programId && programId !== "legacy" && programId !== "mobile") {
    const meta = PROGRAM_REGISTRY[programId as keyof typeof PROGRAM_REGISTRY];
    const programData: Record<string, unknown> = {
      programId,
      lastHeartbeat: now,
      currentState: args.state || "working",
      currentSessionId: sessionId,
    };
    if (meta) {
      programData.displayName = meta.displayName;
      programData.color = meta.color;
      programData.role = meta.role;
    }
    await db.doc(`tenants/${auth.userId}/sessions/_meta/programs/${programId}`).set(programData, { merge: true });
  }

  // Analytics: session_lifecycle create
  emitAnalyticsEvent(auth.userId, {
    eventType: "session_lifecycle",
    programId,
    sessionId,
    toolName: "create_session",
    success: true,
  });

  return jsonResult({ success: true, sessionId, message: `Session created: "${args.name}"` });
}

export async function updateSessionHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateSessionSchema.parse(rawArgs);
  const db = getFirestore();

  const sessionId = args.sessionId || `session_${Date.now()}`;
  const now = serverTimestamp();
  const lifecycleStatus = stateToLifecycle(args.state || "working");

  const updateData: Record<string, unknown> = {
    name: args.status,
    currentAction: args.status,
    status: lifecycleStatus,
    progress: args.progress ?? null,
    lastUpdate: now,
    archived: false,
  };

  if (args.projectName) updateData.projectName = args.projectName;
  if (args.lastHeartbeat) updateData.lastHeartbeat = now;

  if (args.contextBytes !== undefined) updateData.contextBytes = args.contextBytes;
  if (args.handoffRequired !== undefined) updateData.handoffRequired = args.handoffRequired;  await db.doc(`tenants/${auth.userId}/sessions/${sessionId}`).set(updateData, { merge: true });

  // Add to history
  await db.collection(`tenants/${auth.userId}/sessions/${sessionId}/updates`).add({
    status: args.status,
    lifecycleStatus,
    progress: args.progress ?? null,
    createdAt: now,
  });

  // Piggyback program registry write
  const programId = auth.programId;
  if (programId && programId !== "legacy" && programId !== "mobile") {
    const meta = PROGRAM_REGISTRY[programId as keyof typeof PROGRAM_REGISTRY];
    const programData: Record<string, unknown> = {
      programId,
      lastHeartbeat: now,
      currentState: args.state || "working",
      currentSessionId: sessionId,
    };
    if (meta) {
      programData.displayName = meta.displayName;
      programData.color = meta.color;
      programData.role = meta.role;
    }
    await db.doc(`tenants/${auth.userId}/sessions/_meta/programs/${programId}`).set(programData, { merge: true });
  }

  // Analytics: session_lifecycle update
  emitAnalyticsEvent(auth.userId, {
    eventType: "session_lifecycle",
    programId: auth.programId,
    sessionId,
    toolName: "update_session",
    success: true,
  });

  return jsonResult({ success: true, sessionId, message: `Status updated: "${args.status}"` });
}

export async function getFleetHealthHandler(auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  // Admin gate
  if (!["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "get_fleet_health is only accessible by admins.",
    });
  }

  const db = getFirestore();
  const now = Date.now();

  // 3 parallel Firestore queries
  const [programsSnap, pendingRelaySnap, pendingTasksSnap] = await Promise.all([
    db.collection(`tenants/${auth.userId}/sessions/_meta/programs`).get(),
    db.collection(`tenants/${auth.userId}/relay`).where("status", "==", "pending").get(),
    db.collection(`tenants/${auth.userId}/tasks`).where("status", "==", "created").get(),
  ]);

  // Count pending messages by target
  const pendingMsgsByTarget = new Map<string, number>();
  for (const doc of pendingRelaySnap.docs) {
    const target = doc.data().target || "unknown";
    pendingMsgsByTarget.set(target, (pendingMsgsByTarget.get(target) || 0) + 1);
  }

  // Count pending tasks by target
  const pendingTasksByTarget = new Map<string, number>();
  for (const doc of pendingTasksSnap.docs) {
    const target = doc.data().target || "unknown";
    pendingTasksByTarget.set(target, (pendingTasksByTarget.get(target) || 0) + 1);
  }

  const summary = { working: 0, blocked: 0, idle: 0, stale: 0 };
  const programs = programsSnap.docs.map((doc) => {
    const data = doc.data();
    const heartbeatTime = data.lastHeartbeat?.toDate?.() ? data.lastHeartbeat.toDate().getTime() : 0;
    const heartbeatAgeMinutes = heartbeatTime ? Math.round((now - heartbeatTime) / 60000) : null;
    const isStale = heartbeatAgeMinutes !== null && heartbeatAgeMinutes > 10;

    const state = isStale ? "stale" : (data.currentState || "idle");
    if (isStale) summary.stale++;
    else if (state === "working") summary.working++;
    else if (state === "blocked") summary.blocked++;
    else summary.idle++;

    return {
      programId: doc.id,
      state,
      sessionId: data.currentSessionId || null,
      lastHeartbeat: data.lastHeartbeat?.toDate?.()?.toISOString() || null,
      heartbeatAgeMinutes,
      pendingMessages: pendingMsgsByTarget.get(doc.id) || 0,
      pendingTasks: pendingTasksByTarget.get(doc.id) || 0,
      contextBytes: data.contextBytes || null,
      handoffRequired: data.handoffRequired || false,
    };
  });

  return jsonResult({
    success: true,
    programs,
    summary,
  });
}

export async function listSessionsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ListSessionsSchema.parse(rawArgs);
  const db = getFirestore();

  let query: FirebaseFirestore.Query = db.collection(`tenants/${auth.userId}/sessions`);

  if (args.state && args.state !== "all") {
    const lifecycle = stateToLifecycle(args.state);
    query = query.where("status", "==", lifecycle);
  }
  if (!args.includeArchived) {
    query = query.where("archived", "==", false);
  }
  if (args.programId) {
    query = query.where("programId", "==", args.programId);
  }

  query = query.orderBy("lastUpdate", "desc").limit(args.limit);
  const snapshot = await query.get();

  const sessions = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      sessionId: doc.id,
      name: data.name,
      programId: data.programId,
      status: data.currentAction || data.name,
      state: data.status, // lifecycle status
      progress: data.progress,
      projectName: data.projectName,
      lastUpdate: data.lastUpdate?.toDate?.()?.toISOString() || null,
      archived: data.archived || false,
    };
  });

  return jsonResult({ success: true, count: sessions.length, sessions });
}
