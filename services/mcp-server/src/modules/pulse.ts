/**
 * Pulse Module — Session CRUD + heartbeat.
 * Collection: tenants/{uid}/sessions
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { transition, type LifecycleStatus } from "../lifecycle/engine.js";
import { z } from "zod";
import { PROGRAM_REGISTRY } from "../config/programs.js";
import { emitAnalyticsEvent } from "./analytics.js";
import { getComplianceConfig, validateSessionId } from "../config/compliance.js";

/** Approximate context window size in bytes (200KB) */
const CONTEXT_WINDOW_BYTES = 200_000;
/** Maximum context history entries per session (rolling window) */
const MAX_CONTEXT_HISTORY = 1000;

const CreateSessionSchema = z.object({
  name: z.string().max(200),
  sessionId: z.string().max(100).optional(),
  programId: z.string().max(50).optional(),
  status: z.string().max(200).optional(),
  state: z.enum(["working", "blocked", "complete", "pinned"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  projectName: z.string().max(100).optional(),
  bootType: z.enum(["orchestrator", "builder"]).optional(),
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

  // W1.2.1: Session ID format validation
  const complianceConfig = getComplianceConfig(auth.userId);
  const validation = validateSessionId(sessionId);

  if (!validation.valid) {
    if (complianceConfig.sessionIdValidation.enforceFormat) {
      return jsonResult({
        success: false,
        error: `Invalid session ID format: ${validation.reason}`,
        sessionId,
      });
    }
  }

  if (validation.legacy && !complianceConfig.sessionIdValidation.allowLegacy) {
    return jsonResult({
      success: false,
      error: `Legacy session ID format not allowed: ${sessionId}. Use format: {program}[-{env}].{task}`,
      sessionId,
    });
  }

  // Log warning for legacy format
  if (validation.legacy) {
    console.warn(`[W1.2.1] Legacy session ID format used: ${sessionId}. Consider using: {program}[-{env}].{task}`);
  }

  const programId = args.programId || sessionId.split(".")[0];
  const now = serverTimestamp();
  const lifecycleStatus = stateToLifecycle(args.state || "working");

  const sessionData: Record<string, unknown> = {
    name: args.name,
    programId,
    status: lifecycleStatus,
    bootType: args.bootType || null,
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

  // W1.2.1: Session ID format validation
  const complianceConfig = getComplianceConfig(auth.userId);
  const validation = validateSessionId(sessionId);

  if (!validation.valid) {
    if (complianceConfig.sessionIdValidation.enforceFormat) {
      return jsonResult({
        success: false,
        error: `Invalid session ID format: ${validation.reason}`,
        sessionId,
      });
    }
  }

  if (validation.legacy && !complianceConfig.sessionIdValidation.allowLegacy) {
    return jsonResult({
      success: false,
      error: `Legacy session ID format not allowed: ${sessionId}. Use format: {program}[-{env}].{task}`,
      sessionId,
    });
  }

  // Log warning for legacy format
  if (validation.legacy) {
    console.warn(`[W1.2.1] Legacy session ID format used: ${sessionId}. Consider using: {program}[-{env}].{task}`);
  }

  const now = serverTimestamp();
  const lifecycleStatus = stateToLifecycle(args.state || "working");

  // W1.2.2: Derez gate — check pattern extraction before completion
  if (args.state === "complete" && complianceConfig.derezGate.requirePatternExtraction) {
    const sessionRef = db.doc(`tenants/${auth.userId}/sessions/${sessionId}`);
    const sessionDoc = await sessionRef.get();

    if (sessionDoc.exists) {
      const sessionData = sessionDoc.data()!;
      const sessionCreatedAt = sessionData.createdAt?.toDate?.()?.getTime();
      const programId = auth.programId;

      if (sessionCreatedAt && programId && programId !== "legacy" && programId !== "mobile") {
        // Check if program_state.learnedPatterns was updated since session start
        const programStateRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${programId}`);
        const programStateDoc = await programStateRef.get();

        let patternsUpdated = false;
        if (programStateDoc.exists) {
          const programStateData = programStateDoc.data()!;
          const lastUpdatedAt = programStateData.lastUpdatedAt;
          const stateTimestamp = typeof lastUpdatedAt === "string"
            ? new Date(lastUpdatedAt).getTime()
            : lastUpdatedAt?.toDate?.()?.getTime() || 0;

          patternsUpdated = stateTimestamp > sessionCreatedAt;
        }

        if (!patternsUpdated) {
          const message = `[W1.2.2] Session "${sessionId}" completing without pattern extraction. Program "${programId}" has not updated learnedPatterns since session start.`;

          if (complianceConfig.derezGate.mode === "strict") {
            console.error(message);
            return jsonResult({
              success: false,
              error: "Session cannot complete without pattern extraction. Update program_state.learnedPatterns first.",
              sessionId,
              programId,
            });
          } else {
            // Lenient mode: log warning
            console.warn(message);
          }
        }
      }
    }
  }

  const updateData: Record<string, unknown> = {
    name: args.status,
    currentAction: args.status,
    status: lifecycleStatus,
    progress: args.progress ?? null,
    lastUpdate: now,
    archived: lifecycleStatus === "done",
  };

  if (args.projectName) updateData.projectName = args.projectName;
  if (args.lastHeartbeat) updateData.lastHeartbeat = now;

  if (args.contextBytes !== undefined) updateData.contextBytes = args.contextBytes;
  if (args.handoffRequired !== undefined) updateData.handoffRequired = args.handoffRequired;

  await db.doc(`tenants/${auth.userId}/sessions/${sessionId}`).set(updateData, { merge: true });

  // Story 2E: Append context utilization to contextHistory when contextBytes provided
  if (args.contextBytes !== undefined) {
    const contextPercent = Math.round((args.contextBytes / CONTEXT_WINDOW_BYTES) * 10000) / 100;
    const contextEntry = {
      timestamp: new Date().toISOString(),
      contextBytes: args.contextBytes,
      contextPercent,
    };

    const sessionRef = db.doc(`tenants/${auth.userId}/sessions/${sessionId}`);
    const sessionDoc = await sessionRef.get();
    const existingHistory: Array<Record<string, unknown>> = (sessionDoc.data()?.contextHistory as Array<Record<string, unknown>>) || [];

    // Rolling window: cap at MAX_CONTEXT_HISTORY entries
    const updatedHistory = [...existingHistory, contextEntry];
    const trimmedHistory = updatedHistory.length > MAX_CONTEXT_HISTORY
      ? updatedHistory.slice(updatedHistory.length - MAX_CONTEXT_HISTORY)
      : updatedHistory;

    await sessionRef.update({ contextHistory: trimmedHistory });
  }

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

/** Max concurrent sessions (hardcoded MVP — will move to config) */
const MAX_SESSIONS = 8;
/** Context threshold for "above threshold" classification */
const CONTEXT_THRESHOLD_PERCENT = 60;

const GetFleetHealthSchema = z.object({
  detail: z.enum(["summary", "full"]).default("summary"),
});

export async function getFleetHealthHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin gate
  if (!["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "get_fleet_health is only accessible by admins.",
    });
  }

  const args = GetFleetHealthSchema.parse(rawArgs || {});
  const db = getFirestore();
  const now = Date.now();

  // Core queries (both summary and full modes)
  const [programsSnap, pendingRelaySnap, pendingTasksSnap, activeSessionsSnap] = await Promise.all([
    db.collection(`tenants/${auth.userId}/sessions/_meta/programs`).get(),
    db.collection(`tenants/${auth.userId}/relay`).where("status", "==", "pending").get(),
    db.collection(`tenants/${auth.userId}/tasks`).where("status", "==", "created").get(),
    db.collection(`tenants/${auth.userId}/sessions`).where("archived", "==", false).get(),
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

  // === subscriptionBudget (both modes) ===
  const byModelTier: Record<string, number> = {};
  for (const doc of activeSessionsSnap.docs) {
    const model = doc.data().model as string | undefined;
    const tier = model?.includes("opus") ? "opus" : "sonnet";
    byModelTier[tier] = (byModelTier[tier] || 0) + 1;
  }
  const activeSessionCount = activeSessionsSnap.size;
  const subscriptionBudget = {
    activeSessionCount,
    byModelTier,
    maxSessions: MAX_SESSIONS,
    utilizationPercent: Math.round((activeSessionCount / MAX_SESSIONS) * 10000) / 100,
  };

  // Summary mode: return early
  if (args.detail === "summary") {
    return jsonResult({
      success: true,
      detail: "summary",
      programs,
      summary,
      subscriptionBudget,
    });
  }

  // === Full mode: add contextHealth + taskContention + rateLimits ===

  const oneHourAgo = admin.firestore.Timestamp.fromMillis(now - 60 * 60 * 1000);

  // Parallel telemetry queries for full mode
  const [claimEventsSnap, rateLimitEventsSnap] = await Promise.all([
    db.collection(`tenants/${auth.userId}/claim_events`)
      .where("timestamp", ">=", oneHourAgo)
      .get(),
    db.collection(`tenants/${auth.userId}/rate_limit_events`)
      .where("timestamp", ">=", oneHourAgo)
      .get(),
  ]);

  // --- contextHealth ---
  const contextSessions: Array<{
    sessionId: string;
    programId: string | null;
    contextPercent: number;
    contextBytes: number;
  }> = [];

  for (const doc of activeSessionsSnap.docs) {
    const data = doc.data();
    if (data.contextBytes) {
      const contextPercent = Math.round((Number(data.contextBytes) / CONTEXT_WINDOW_BYTES) * 10000) / 100;
      contextSessions.push({
        sessionId: doc.id,
        programId: data.programId || null,
        contextPercent,
        contextBytes: Number(data.contextBytes),
      });
    }
  }

  const avgContextPercent = contextSessions.length > 0
    ? Math.round(contextSessions.reduce((sum, s) => sum + s.contextPercent, 0) / contextSessions.length * 100) / 100
    : 0;
  const sessionsAboveThreshold = contextSessions.filter((s) => s.contextPercent > CONTEXT_THRESHOLD_PERCENT).length;

  const contextHealth = {
    sessions: contextSessions,
    avgContextPercent,
    sessionsAboveThreshold,
  };

  // --- taskContention ---
  let claimsAttempted = 0;
  let claimsWon = 0;
  let contentionEvents = 0;
  const claimedTaskIds: string[] = [];

  for (const doc of claimEventsSnap.docs) {
    const data = doc.data();
    claimsAttempted++;
    if (data.outcome === "claimed") {
      claimsWon++;
      if (data.taskId) claimedTaskIds.push(data.taskId as string);
    } else if (data.outcome === "contention") {
      contentionEvents++;
    }
  }

  // Compute mean time to claim
  let meanTimeToClaimMs: number | null = null;
  if (claimedTaskIds.length > 0) {
    const uniqueTaskIds = [...new Set(claimedTaskIds)].slice(0, 100);
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

    let totalClaimLatencyMs = 0;
    let latencySamples = 0;
    for (const doc of claimEventsSnap.docs) {
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

  const taskContention = {
    contentionRate: claimsAttempted > 0
      ? Math.round((contentionEvents / claimsAttempted) * 10000) / 100
      : 0,
    meanTimeToClaimMs,
    claimsAttempted,
    claimsWon,
  };

  // --- rateLimits ---
  const endpointCounts = new Map<string, number>();
  for (const doc of rateLimitEventsSnap.docs) {
    const endpoint = doc.data().endpoint as string || "unknown";
    endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + 1);
  }

  const eventsByEndpoint = Array.from(endpointCounts.entries())
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const rateLimits = {
    eventsLastHour: rateLimitEventsSnap.size,
    eventsByEndpoint,
  };

  return jsonResult({
    success: true,
    detail: "full",
    programs,
    summary,
    subscriptionBudget,
    contextHealth,
    taskContention,
    rateLimits,
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

// === Story 2E: Context Utilization Query ===

const GetContextUtilizationSchema = z.object({
  sessionId: z.string().max(100).optional(),
  period: z.enum(["today", "this_week", "this_month"]).default("today"),
});

function contextPeriodStart(period: string): Date {
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
    default:
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

export async function getContextUtilizationHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetContextUtilizationSchema.parse(rawArgs || {});
  const db = getFirestore();

  const start = contextPeriodStart(args.period);

  if (args.sessionId) {
    // Return specific session's contextHistory
    const sessionDoc = await db.doc(`tenants/${auth.userId}/sessions/${args.sessionId}`).get();

    if (!sessionDoc.exists) {
      return jsonResult({ success: false, error: "Session not found." });
    }

    const data = sessionDoc.data()!;
    const fullHistory: Array<Record<string, unknown>> = (data.contextHistory as Array<Record<string, unknown>>) || [];

    // Filter by period
    const filtered = fullHistory.filter((entry) => {
      const ts = entry.timestamp as string;
      if (!ts) return false;
      return new Date(ts).getTime() >= start.getTime();
    });

    return jsonResult({
      success: true,
      sessionId: args.sessionId,
      period: args.period,
      count: filtered.length,
      contextHistory: filtered,
      currentContextBytes: data.contextBytes || null,
      currentContextPercent: data.contextBytes
        ? Math.round((Number(data.contextBytes) / CONTEXT_WINDOW_BYTES) * 10000) / 100
        : null,
    });
  }

  // Aggregate across all active sessions
  const sessionsSnap = await db
    .collection(`tenants/${auth.userId}/sessions`)
    .where("archived", "==", false)
    .get();

  const sessionSummaries: Array<Record<string, unknown>> = [];

  for (const doc of sessionsSnap.docs) {
    const data = doc.data();
    const fullHistory: Array<Record<string, unknown>> = (data.contextHistory as Array<Record<string, unknown>>) || [];

    // Filter by period
    const filtered = fullHistory.filter((entry) => {
      const ts = entry.timestamp as string;
      if (!ts) return false;
      return new Date(ts).getTime() >= start.getTime();
    });

    if (filtered.length > 0 || data.contextBytes) {
      sessionSummaries.push({
        sessionId: doc.id,
        programId: data.programId || null,
        currentContextBytes: data.contextBytes || null,
        currentContextPercent: data.contextBytes
          ? Math.round((Number(data.contextBytes) / CONTEXT_WINDOW_BYTES) * 10000) / 100
          : null,
        historyCount: filtered.length,
        latestEntry: filtered.length > 0 ? filtered[filtered.length - 1] : null,
      });
    }
  }

  return jsonResult({
    success: true,
    period: args.period,
    activeSessions: sessionSummaries.length,
    sessions: sessionSummaries,
  });
}
