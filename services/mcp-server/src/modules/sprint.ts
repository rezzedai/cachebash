/**
 * Sprint Module — Sprint lifecycle management.
 * Sprints are tasks with type: "sprint", stories are type: "sprint-story"
 * All in tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { syncSprintCreated, syncSprintCompleted, syncStoryUpdated } from "./github-sync.js";
import { emitAnalyticsEvent } from "./analytics.js";
import { generateSpanId } from "../utils/trace.js";
import { CONSTANTS } from "../config/constants.js";
import { Timestamp } from "firebase-admin/firestore";
import { credentialPrincipal, hasFleetAdminCapability, hasFleetObserveCapability } from "../auth/ownerAuthz.js";
import { logDenial } from "../auth/denialLog.js";
import { TASK_OVERRIDE_PRINCIPALS } from "./dispatch/shared.js";

// W2e: sprints, sprint-stories, and the escalation-failure fallback task are all
// open work with no natural expiry of their own — same "everything else -> sentinel"
// branch expiresAtBackfillClassifier.ts uses for these exact types. Shared so the
// four write sites below can't drift from each other or from the classifier.
const NEVER_EXPIRES = Timestamp.fromDate(new Date(CONSTANTS.ttl.neverExpiresSentinel));

const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  wave: z.number().optional(),
  dependencies: z.array(z.string()).optional(),
  complexity: z.enum(["normal", "high"]).optional(),
  retryPolicy: z.enum(["none", "auto_retry", "escalate"]).default("none"),
  maxRetries: z.number().min(0).max(5).default(1),
});

const CreateSprintSchema = z.object({
  projectName: z.string().max(100),
  branch: z.string().max(100),
  stories: z.array(StorySchema),
  sessionId: z.string().optional(),
  config: z.object({
    orchestratorModel: z.string().optional(),
    subagentModel: z.string().optional(),
    maxConcurrent: z.number().optional(),
  }).optional(),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const UpdateStorySchema = z.object({
  sprintId: z.string(),
  storyId: z.string(),
  status: z.enum(["queued", "active", "complete", "failed", "skipped"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  currentAction: z.string().max(200).optional(),
  model: z.string().optional(),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const AddStorySchema = z.object({
  sprintId: z.string(),
  story: StorySchema,
  insertionMode: z.enum(["current_wave", "next_wave", "backlog"]).default("next_wave"),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const CompleteSprintSchema = z.object({
  sprintId: z.string(),
  summary: z.object({
    completed: z.number().optional(),
    failed: z.number().optional(),
    skipped: z.number().optional(),
    duration: z.number().optional(),
  }).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Escalate story failure to ISO via relay */
async function escalateToIso(
  auth: AuthContext,
  sprintId: string,
  storyId: string,
  storyTitle: string
): Promise<void> {
  try {
    const { sendMessageHandler } = await import("./relay.js");
    await sendMessageHandler(auth, {
      message: `Sprint story failed after retries exhausted. Sprint: ${sprintId}, Story: ${storyId} (${storyTitle})`,
      source: "sprint-engine",
      target: "orchestrator",
      message_type: "RESULT",
      priority: "high",
      action: "interrupt",
      payload: {
        outcome: "failure",
        taskId: storyId,
        summary: `Story "${storyTitle}" failed in sprint ${sprintId} — retries exhausted or escalation policy triggered`,
      },
    });
  } catch (err) {
    console.error("[Sprint] Escalation to ISO failed:", err);
    // Fallback: create an alert task so the failure isn't silently lost
    try {
      const db = getFirestore();
      await db.collection(`tenants/${auth.userId}/tasks`).add({
        schemaVersion: '2.2' as const,
        type: "task",
        title: `[ESCALATION FAILED] Sprint story ${storyId} failed in ${sprintId}`,
        instructions: `Escalation relay failed. Story "${storyTitle}" failed in sprint ${sprintId} — retries exhausted. Original error: ${err instanceof Error ? err.message : String(err)}`,
        source: "sprint-engine",
        target: "iso",
        priority: "high",
        action: "interrupt",
        status: "created",
        createdAt: serverTimestamp(),
        encrypted: false,
        archived: false,
        ttl: 0,
        expiresAt: NEVER_EXPIRES,
        // WP-1: target "iso", not "user" — program-directed escalation, actionable.
        requires_action: true,
      });
    } catch (fallbackErr) {
      console.error("[Sprint] Fallback alert task also failed:", fallbackErr);
    }
  }
}

/** Map sprint story status to lifecycle */
export function storyStatusToLifecycle(status: string): string {
  switch (status) {
    case "queued": return "created";
    case "active": return "active";
    case "complete": return "done";
    case "failed": return "failed";
    case "skipped": return "archived";
    default: return "created";
  }
}

// ── Authorization (RD-5 PR-L row 33, L-D7 option 2 with 20.1 item 3) ───────
// A sprint records its creator (`createdBy`). Writes need the creator, the iso and dispatcher override, the literal fleet.admin capability, or mobile.
// Reads add TASKS_ALL_PRINCIPALS and literal fleet.observe. A sprint with no createdBy fails closed: override, fleet.admin or mobile only.

const SPRINT_ALL: readonly string[] = ["mobile"];

export function mayActOnSprint(auth: AuthContext, p: string, sprint: { createdBy?: unknown } | undefined, kind: "read" | "write"): boolean {
  if (!sprint) return false;
  if (SPRINT_ALL.includes(p) || (TASK_OVERRIDE_PRINCIPALS as readonly string[]).includes(p) || hasFleetAdminCapability(auth)) return true;
  if (typeof sprint.createdBy !== "string" || sprint.createdBy === "") return false;
  if (sprint.createdBy === p) return true;
  return kind === "read" && (p === "dispatcher" || hasFleetObserveCapability(auth));
}

/** Reads the sprint parent and decides. Returns the denial result, or null when allowed. */
async function authorizeSprint(auth: AuthContext, sprintId: string, kind: "read" | "write", tool: string, verb: string): Promise<ToolResult | null> {
  const p = credentialPrincipal(auth);
  const doc = await getFirestore().doc(`tenants/${auth.userId}/tasks/${sprintId}`).get();
  const data = doc.exists ? doc.data() : undefined;
  if (data && data.type !== "sprint") return jsonResult({ success: false, error: "Document is not a sprint" });
  if (!data) return jsonResult({ success: false, error: "Sprint not found" });
  if (mayActOnSprint(auth, p, data, kind)) return null;
  logDenial({ principal: p, tool, subject: typeof data.createdBy === "string" ? data.createdBy : null, code: "NOT_OWNER" });
  return jsonResult({ success: false, error: `Access denied: "${p}" cannot ${verb} "${sprintId}"` });
}

export async function createSprintHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateSprintSchema.parse(rawArgs);
  const db = getFirestore();
  const now = serverTimestamp();

  // Agent Trace L2: sprint gets its own spanId as parent for child stories
  const sprintSpanId = args.spanId || generateSpanId();

  // Create parent sprint task
  const sprintData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    type: "sprint",
    title: `Sprint: ${args.projectName}`,
    instructions: "",
    source: "orchestrator",
    createdBy: credentialPrincipal(auth), // RD-5 PR-L L-D7
    target: null,
    priority: "high",
    action: "sprint",
    status: "active",
    sprint: {
      projectName: args.projectName,
      branch: args.branch,
      config: args.config || null,
      definition: args.stories.map((s) => ({
        id: s.id,
        title: s.title,
        wave: s.wave || 1,
        dependencies: s.dependencies || [],
        complexity: s.complexity || "normal",
        retryPolicy: s.retryPolicy || "none",
        maxRetries: s.maxRetries ?? 1,
      })),
    },
    sessionId: args.sessionId || null,
    createdAt: now,
    startedAt: now,
    encrypted: false,
    archived: false,
    // Agent Trace L2
    traceId: args.traceId || null,
    spanId: sprintSpanId,
    parentSpanId: args.parentSpanId || null,
    ttl: 0,
    expiresAt: NEVER_EXPIRES,
    // WP-1: target is null (sprint parent has no single program target) —
    // scheduled/program-directed work is actionable by default.
    requires_action: true,
  };

  const sprintRef = await db.collection(`tenants/${auth.userId}/tasks`).add(sprintData);
  const sprintId = sprintRef.id;

  // Create child sprint-story tasks
  const batch = db.batch();
  for (const story of args.stories) {
    const storyRef = db.collection(`tenants/${auth.userId}/tasks`).doc();
    batch.set(storyRef, {
      schemaVersion: '2.2' as const,
      type: "sprint-story",
      title: story.title,
      instructions: "",
      source: "orchestrator",
      target: null,
      priority: "normal",
      action: "sprint",
      status: "created",
      sprint: {
        parentId: sprintId,
        projectName: args.projectName,
        branch: args.branch,
        wave: story.wave || 1,
        dependencies: story.dependencies || [],
        complexity: story.complexity || "normal",
      },
      retry: {
        policy: story.retryPolicy || "none",
        maxRetries: story.maxRetries ?? 1,
        retryCount: 0,
        retryHistory: [],
      },
      createdAt: now,
      encrypted: false,
      archived: false,
      // Agent Trace L2: child spans inherit traceId, parent is sprint's spanId
      traceId: args.traceId || null,
      spanId: generateSpanId(),
      parentSpanId: sprintSpanId,
      ttl: 0,
      expiresAt: NEVER_EXPIRES,
      // WP-1: target null — see parent sprint task above.
      requires_action: true,
    });
  }
  await batch.commit();

  // Fire-and-forget: sync sprint to GitHub Milestone + Issues
  syncSprintCreated(auth.userId, sprintId, args.projectName, args.stories, null);

  // Analytics: sprint_lifecycle create
  emitAnalyticsEvent(auth.userId, {
    eventType: "sprint_lifecycle",
    programId: credentialPrincipal(auth),
    toolName: "create_sprint",
    success: true,
  });

  return jsonResult({
    success: true,
    sprintId,
    storiesCreated: args.stories.length,
    message: `Sprint created with ${args.stories.length} stories`,
  });
}

export async function updateStoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateStorySchema.parse(rawArgs);
  const db = getFirestore();
  const denied = await authorizeSprint(auth, args.sprintId, "write", "sprint_update_story", "update sprint");
  if (denied) return denied;

  // Find the story by looking for sprint-story tasks with matching sprint.parentId
  const snapshot = await db
    .collection(`tenants/${auth.userId}/tasks`)
    .where("type", "==", "sprint-story")
    .where("sprint.parentId", "==", args.sprintId)
    .get();

  // Find the specific story by storyId (stored in a field or matched by doc ID)
  const storyDoc = snapshot.docs.find((doc) => {
    const data = doc.data();
    return doc.id === args.storyId || data.title?.includes(args.storyId);
  });

  if (!storyDoc) {
    return jsonResult({ success: false, error: "Story not found" });
  }

  const updateData: Record<string, unknown> = {};

  if (args.status) {
    updateData.status = storyStatusToLifecycle(args.status);
    if (args.status === "active") updateData.startedAt = serverTimestamp();
    if (args.status === "complete" || args.status === "failed" || args.status === "skipped") {
      updateData.completedAt = serverTimestamp();
    }
  }
  if (args.progress !== undefined) updateData["sprint.currentAction"] = args.currentAction || null;
  if (args.currentAction) updateData["sprint.currentAction"] = args.currentAction;
  if (args.model) updateData.model = args.model;
  // Agent Trace L2: propagate trace context on story update
  if (args.traceId) updateData.traceId = args.traceId;
  if (args.spanId) updateData.spanId = args.spanId;
  if (args.parentSpanId) updateData.parentSpanId = args.parentSpanId;

  // Retry/escalation logic
  if (args.status === "failed") {
    const storyData = storyDoc.data();
    const retry = storyData.retry || { policy: "none", maxRetries: 1, retryCount: 0, retryHistory: [] };

    if (retry.policy === "auto_retry" && retry.retryCount < retry.maxRetries) {
      // Auto-retry: reset to created, increment count
      updateData.status = "created";
      updateData["retry.retryCount"] = retry.retryCount + 1;
      
      // Linear backoff: 30s * attempt number
      const backoffMs = (retry.retryCount + 1) * 30000;
      const retryAfter = new Date(Date.now() + backoffMs).toISOString();
      updateData["retry.retryAfter"] = retryAfter;
      
      updateData["retry.retryHistory"] = [
        ...(retry.retryHistory || []),
        { 
          attempt: retry.retryCount + 1, 
          failedAt: new Date().toISOString(),
        },
      ];
      delete updateData.completedAt;
      
      // Emit retry event
      const { emitEvent } = await import("./events.js");
      emitEvent(auth.userId, {
        event_type: "TASK_RETRIED",
        task_id: args.storyId,
        program_id: credentialPrincipal(auth),
        attempt: retry.retryCount + 1,
        max_retries: retry.maxRetries,
        sprint_id: args.sprintId,
      });
    } else if (retry.policy === "escalate" || (retry.policy === "auto_retry" && retry.retryCount >= retry.maxRetries)) {
      // Escalate to ISO
      await escalateToIso(auth, args.sprintId, args.storyId, storyData.title || args.storyId);
      
      // Emit exhaustion event
      const { emitEvent } = await import("./events.js");
      emitEvent(auth.userId, {
        event_type: "TASK_RETRY_EXHAUSTED",
        task_id: args.storyId,
        program_id: credentialPrincipal(auth),
        total_attempts: retry.retryCount,
        sprint_id: args.sprintId,
      });
    }
    // "none" policy: default behavior, just mark failed (already set above)
  }

  await storyDoc.ref.update(updateData);

  if (args.status) {
    (async () => {
      await syncStoryUpdated(auth.userId, args.sprintId, storyDoc.id, args.status);
    })().catch((err) => {
      console.error("[GH Sync] Story update failed:", err);
    });
  }

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    storyId: args.storyId,
    message: "Story updated",
  });
}

export async function addStoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = AddStorySchema.parse(rawArgs);
  const db = getFirestore();
  const denied = await authorizeSprint(auth, args.sprintId, "write", "sprint_add_story_to_sprint", "update sprint");
  if (denied) return denied;

  const storyRef = db.collection(`tenants/${auth.userId}/tasks`).doc();

  // Determine wave based on insertion mode
  let wave = 1;
  if (args.insertionMode === "backlog") wave = 999;

  await storyRef.set({
    schemaVersion: '2.2' as const,
    type: "sprint-story",
    title: args.story.title,
    instructions: "",
    source: "orchestrator",
    target: null,
    priority: "normal",
    action: "sprint",
    status: "created",
    sprint: {
      parentId: args.sprintId,
      wave,
      dependencies: args.story.dependencies || [],
      complexity: args.story.complexity || "normal",
    },
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
    addedDynamically: true,
    // Agent Trace L2
    traceId: args.traceId || null,
    spanId: args.spanId || generateSpanId(),
    parentSpanId: args.parentSpanId || null,
    ttl: 0,
    expiresAt: NEVER_EXPIRES,
    // WP-1: target null — see createSprintHandler's parent sprint task.
    requires_action: true,
  });

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    storyId: storyRef.id,
    wave,
    message: `Story added to sprint (wave ${wave})`,
  });
}

export async function completeSprintHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CompleteSprintSchema.parse(rawArgs);
  const db = getFirestore();
  const denied = await authorizeSprint(auth, args.sprintId, "write", "sprint_complete_sprint", "update sprint");
  if (denied) return denied;
  const sprintRef = db.doc(`tenants/${auth.userId}/tasks/${args.sprintId}`);

  // Auto-calculate summary if not provided
  let summary = args.summary;
  if (!summary) {
    const stories = await db
      .collection(`tenants/${auth.userId}/tasks`)
      .where("type", "==", "sprint-story")
      .where("sprint.parentId", "==", args.sprintId)
      .get();

    let completed = 0, failed = 0, skipped = 0;
    for (const doc of stories.docs) {
      const s = doc.data().status;
      if (s === "done") completed++;
      else if (s === "failed") failed++;
      else if (s === "archived") skipped++;
    }
    summary = { completed, failed, skipped };
  }

  await sprintRef.update({
    status: "done",
    completedAt: serverTimestamp(),
    "sprint.summary": summary,
  });

  // Fire-and-forget: close GitHub Milestone
  syncSprintCompleted(auth.userId, args.sprintId);

  // Analytics: sprint_lifecycle complete
  emitAnalyticsEvent(auth.userId, {
    eventType: "sprint_lifecycle",
    programId: credentialPrincipal(auth),
    toolName: "complete_sprint",
    success: true,
  });

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    summary,
    message: "Sprint completed",
  });
}

const GetSprintSchema = z.object({
  sprintId: z.string(),
});

export async function getSprintHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetSprintSchema.parse(rawArgs || {});
  const db = getFirestore();

  // Fetch sprint doc
  const sprintDoc = await db.doc(`tenants/${auth.userId}/tasks/${args.sprintId}`).get();
  if (!sprintDoc.exists) {
    return jsonResult({ success: false, error: "Sprint not found" });
  }

  const sprintData = sprintDoc.data()!;
  if (sprintData.type !== "sprint") {
    return jsonResult({ success: false, error: "Document is not a sprint" });
  }
  const getPrincipal = credentialPrincipal(auth);
  if (!mayActOnSprint(auth, getPrincipal, sprintData, "read")) {
    logDenial({ principal: getPrincipal, tool: "sprint_get_sprint", subject: typeof sprintData.createdBy === "string" ? sprintData.createdBy : null, code: "NOT_OWNER" });
    return jsonResult({ success: false, error: `Access denied: "${getPrincipal}" cannot read sprint "${args.sprintId}"` });
  }

  // Fetch all child stories
  const storiesSnapshot = await db
    .collection(`tenants/${auth.userId}/tasks`)
    .where("type", "==", "sprint-story")
    .where("sprint.parentId", "==", args.sprintId)
    .get();

  const stories = storiesSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      status: data.status,
      wave: data.sprint?.wave || 1,
      dependencies: data.sprint?.dependencies || [],
      complexity: data.sprint?.complexity || "normal",
      currentAction: data.sprint?.currentAction || null,
      retry: data.retry || null,
      startedAt: data.startedAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
    };
  });

  // Calculate stats
  const stats = {
    total: stories.length,
    completed: stories.filter((s) => s.status === "done").length,
    failed: stories.filter((s) => s.status === "failed").length,
    active: stories.filter((s) => s.status === "active").length,
    queued: stories.filter((s) => s.status === "created").length,
  };

  return jsonResult({
    success: true,
    sprint: {
      id: sprintDoc.id,
      title: sprintData.title,
      status: sprintData.status,
      projectName: sprintData.sprint?.projectName,
      branch: sprintData.sprint?.branch,
      config: sprintData.sprint?.config || null,
      definition: sprintData.sprint?.definition || null,
      createdAt: sprintData.createdAt?.toDate?.()?.toISOString() || null,
      startedAt: sprintData.startedAt?.toDate?.()?.toISOString() || null,
      completedAt: sprintData.completedAt?.toDate?.()?.toISOString() || null,
    },
    stories,
    stats,
  });
}
