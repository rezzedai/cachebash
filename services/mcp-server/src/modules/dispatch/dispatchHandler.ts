/**
 * Dispatch Handler — The `dispatch()` meta-tool.
 *
 * Composes task creation + directive send + uptake verification into a single
 * atomic operation. Enforces the Grid dispatch protocol at the tooling level:
 *
 *   1. PRE-FLIGHT:  Check target heartbeat → classify ALIVE | STALE | ABSENT
 *   2. AUTO-WAKE:   Trigger wake daemon if target stale/absent (optional)
 *   3. SEND:        Create task + send directive
 *   4. UPTAKE:      Poll task status until claimed or timeout
 *
 * This replaces the multi-step dispatch procedure that was prone to silent failures
 * when programs would send directives to dead targets.
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { verifySource } from "../../middleware/gate.js";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import { isGroupTarget } from "../../config/programs.js";
import { isProgramRegistered } from "../programRegistry.js";
import { SPAWNABLE_PROGRAMS } from "../../config/launch.js";
import { wakeTarget, queryTargetState } from "../wake/index.js";
import { syncTaskCreated } from "../github-sync.js";
import { emitEvent, classifyTask } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { generateSpanId } from "../../utils/trace.js";
import { notifyDispatcher } from "../../webhooks/dispatcher-notify.js";
import { logDirective } from "../ack-compliance.js";
import { CONSTANTS } from "../../config/constants.js";
import { type ToolResult, jsonResult } from "./shared.js";
import type { TargetState, WakeResult, SpawnSpec, DispatchResponse } from "../../types/dispatch.js";

/** Default uptake polling interval */
const UPTAKE_POLL_INTERVAL_MS = 5_000;

/** Default uptake timeout */
const DEFAULT_UPTAKE_TIMEOUT_SECONDS = 45;

const DispatchSchema = z.object({
  source: z.string().max(100),
  target: z.string().max(100),
  title: z.string().max(200),
  instructions: z.string().max(32000).optional(),
  priority: z.enum(["low", "normal", "high"]).default("high"),
  action: z.enum(["interrupt", "sprint", "parallel", "queue", "backlog"]).default("interrupt"),
  waitForUptake: z.boolean().default(true),
  uptakeTimeoutSeconds: z.number().min(5).max(120).default(DEFAULT_UPTAKE_TIMEOUT_SECONDS),
  autoWake: z.boolean().default(true),
  threadId: z.string().optional(),
  projectId: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── PRE-FLIGHT & AUTO-WAKE ──────────────────────────────────────────────────
// Delegated to modules/wake/onDemandWake.ts for shared use across dispatch(),
// send_directive enrichment, and the /v1/internal/wake-target endpoint.

// ─── SEND ────────────────────────────────────────────────────────────────────

interface SendResult {
  taskId: string;
  directiveId: string | null;
}

/**
 * Create a task and send a directive to the target program.
 * Composes the existing createTask + sendDirective logic internally.
 */
async function sendTaskAndDirective(
  auth: AuthContext,
  args: z.infer<typeof DispatchSchema>,
  verifiedSource: string,
): Promise<SendResult> {
  const db = getFirestore();
  const now = serverTimestamp();
  const traceId = args.traceId || generateSpanId();
  const spanId = args.spanId || generateSpanId();

  // ── Create task ──
  const preview = args.title.length > 50 ? args.title.substring(0, 47) + "..." : args.title;
  const taskData: Record<string, unknown> = {
    schemaVersion: "2.2",
    type: "task",
    title: args.title,
    instructions: args.instructions || "",
    preview,
    source: verifiedSource,
    target: args.target,
    priority: args.priority,
    action: args.action,
    status: "created",
    projectId: args.projectId || null,
    boardItemId: null,
    createdAt: now,
    encrypted: false,
    archived: false,
    ttl: CONSTANTS.ttl.defaultTaskSeconds,
    replyTo: null,
    threadId: args.threadId || null,
    provenance: null,
    fallback: null,
    traceId,
    spanId,
    parentSpanId: args.parentSpanId || null,
    requires_action: true,
    auto_archived: false,
    task_class: classifyTask("task", args.action || "interrupt", args.title),
    attempt_count: 0,
    // Dispatch metadata
    dispatched_via: "dispatch_tool",
  };

  // Set TTL expiration
  const effectiveTtl = CONSTANTS.ttl.defaultTaskSeconds;
  if (effectiveTtl) {
    taskData.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + effectiveTtl * 1000);
  }

  const taskRef = await db.collection(`tenants/${auth.userId}/tasks`).add(taskData);

  // Fire-and-forget: telemetry, GitHub sync, dispatcher webhook
  emitEvent(auth.userId, {
    event_type: "TASK_CREATED",
    program_id: verifiedSource,
    task_id: taskRef.id,
    task_class: taskData.task_class as "WORK" | "CONTROL",
    target: args.target,
    type: "task",
    priority: args.priority,
    action: args.action,
    dispatched_via: "dispatch_tool",
  });

  emitAnalyticsEvent(auth.userId, {
    eventType: "task_lifecycle",
    programId: verifiedSource,
    toolName: "dispatch",
    taskType: "task",
    priority: args.priority,
    action: args.action,
    success: true,
  });

  notifyDispatcher({
    taskId: taskRef.id,
    target: args.target,
    priority: args.priority || "high",
    title: args.title,
    timestamp: new Date().toISOString(),
  });

  syncTaskCreated(
    auth.userId,
    taskRef.id,
    args.title,
    args.instructions || "",
    args.action || "interrupt",
    args.priority || "high",
    args.projectId,
    "task",
    undefined,
  );

  // ── Send directive ──
  let directiveId: string | null = null;
  try {
    const directiveMessage = args.instructions
      ? `[dispatch:${taskRef.id}] ${args.title}\n\n${args.instructions.substring(0, 1800)}`
      : `[dispatch:${taskRef.id}] ${args.title}`;

    const relayData: Record<string, unknown> = {
      message: directiveMessage.substring(0, 2000),
      source: verifiedSource,
      target: args.target,
      message_type: "DIRECTIVE",
      action: "interrupt",
      priority: args.priority || "high",
      status: "pending",
      ttl: 86400,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400 * 1000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      threadId: args.threadId || null,
      traceId,
      spanId: generateSpanId(),
      parentSpanId: spanId,
      // Link back to the task
      taskId: taskRef.id,
    };

    const relayRef = await db.collection(`tenants/${auth.userId}/relay`).add(relayData);
    directiveId = relayRef.id;

    // Log for ACK compliance
    logDirective(auth.userId, relayRef.id, verifiedSource, args.target, directiveMessage.substring(0, 2000), args.threadId).catch(() => {});

    emitEvent(auth.userId, {
      event_type: "RELAY_SENT",
      program_id: verifiedSource,
      message_id: relayRef.id,
      message_type: "DIRECTIVE",
      target: args.target,
      dispatched_via: "dispatch_tool",
    });
  } catch (err) {
    // Directive send failed — task still exists for target to discover
    console.error(`[Dispatch] Directive send failed for task ${taskRef.id}:`, err);
  }

  return { taskId: taskRef.id, directiveId };
}

// ─── UPTAKE WAIT ─────────────────────────────────────────────────────────────

interface UptakeResult {
  confirmed: boolean;
  claimedBy?: string;
  claimedAt?: string;
}

/**
 * Poll task status until it transitions from 'created' to 'active' (claimed).
 * Returns confirmation of uptake or timeout.
 */
async function waitForUptake(
  userId: string,
  taskId: string,
  timeoutSeconds: number,
): Promise<UptakeResult> {
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${userId}/tasks/${taskId}`);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await sleep(UPTAKE_POLL_INTERVAL_MS);

    const doc = await taskRef.get();
    if (!doc.exists) {
      // Task was deleted — unusual, bail out
      return { confirmed: false };
    }

    const data = doc.data()!;
    if (data.status === "active" || data.status === "completing" || data.status === "done") {
      return {
        confirmed: true,
        claimedBy: data.claimedBy || data.sessionId || undefined,
        claimedAt: data.startedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    }
  }

  return { confirmed: false };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

export async function dispatchHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = DispatchSchema.parse(rawArgs);

  // Enforce source identity
  const verifiedSource = verifySource(args.source, auth, "mcp");

  // Validate target is a known program
  if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {
    const isKnown = await isProgramRegistered(auth.userId, args.target);
    if (!isKnown) {
      return jsonResult({
        success: false,
        error: `Unknown target program: "${args.target}". Use a valid program ID.`,
      });
    }
  }

  // ── 1. PRE-FLIGHT ──
  const flight = await queryTargetState(auth.userId, args.target);

  // Emit pre-flight telemetry
  emitEvent(auth.userId, {
    event_type: "DISPATCH_PREFLIGHT",
    program_id: verifiedSource,
    target: args.target,
    target_state: flight.targetState,
    heartbeat_age_ms: flight.heartbeatAgeMs === Infinity ? -1 : flight.heartbeatAgeMs,
  });

  // ── 2. AUTO-WAKE (if target is not alive and autoWake enabled) ──
  let wakeAttempted = false;
  let wakeResultStr: WakeResult = "skipped";
  let currentTargetState = flight.targetState;

  if (flight.targetState !== "alive" && args.autoWake) {
    wakeAttempted = true;
    const wake = await wakeTarget({
      userId: auth.userId,
      target: args.target,
      waitForAlive: true,
      callerSource: verifiedSource,
    });

    // Map wake module outcomes to dispatch WakeResult type
    switch (wake.outcome) {
      case "success":
      case "already_alive":
        wakeResultStr = "success";
        currentTargetState = "alive";
        break;
      case "timeout":
      case "spawned_pending":
        wakeResultStr = "timeout";
        currentTargetState = wake.targetState;
        break;
      case "not_spawnable":
        wakeResultStr = "not_spawnable";
        currentTargetState = wake.targetState;
        break;
      case "host_unreachable":
        wakeResultStr = "host_unreachable";
        currentTargetState = wake.targetState;
        break;
      case "debounced":
        wakeResultStr = "skipped";
        currentTargetState = wake.targetState;
        break;
    }

    emitEvent(auth.userId, {
      event_type: "DISPATCH_WAKE",
      program_id: verifiedSource,
      target: args.target,
      wake_result: wakeResultStr,
      new_state: currentTargetState,
      wake_outcome: wake.outcome,
      debounce_remaining: wake.debounceRemainingSeconds,
    });
  }

  // ── 3. SEND (always — even if target is stale, task queues for later) ──
  const { taskId, directiveId } = await sendTaskAndDirective(auth, args, verifiedSource);

  // ── 4. UPTAKE WAIT ──
  let uptakeConfirmed = false;
  let claimedBy: string | undefined;
  let claimedAt: string | undefined;

  if (args.waitForUptake) {
    const uptake = await waitForUptake(auth.userId, taskId, args.uptakeTimeoutSeconds);
    uptakeConfirmed = uptake.confirmed;
    claimedBy = uptake.claimedBy;
    claimedAt = uptake.claimedAt;
  }

  // ── Build response ──
  const spawnConfig = SPAWNABLE_PROGRAMS.get(args.target);
  const needsSpawn = !uptakeConfirmed && currentTargetState !== "alive";

  const response: DispatchResponse = {
    success: uptakeConfirmed || (currentTargetState === "alive" && !args.waitForUptake),
    taskId,
    directiveId,
    targetState: currentTargetState,
    uptakeConfirmed,
    claimedBy,
    claimedAt,
    heartbeatAge: flight.heartbeatAge,
    wakeAttempted: wakeAttempted || undefined,
    wakeResult: wakeAttempted ? wakeResultStr : undefined,
    action_required: needsSpawn ? "spawn_target" : uptakeConfirmed ? "none" : "retry",
    spawnSpec: needsSpawn && spawnConfig
      ? {
          programId: args.target,
          model: spawnConfig.model,
          repo: spawnConfig.repo,
          description: spawnConfig.description,
        }
      : undefined,
    message: uptakeConfirmed
      ? `Dispatched to ${args.target} — task claimed${claimedBy ? ` by ${claimedBy}` : ""}.`
      : currentTargetState === "alive" && !args.waitForUptake
        ? `Dispatched to ${args.target} (alive, uptake check skipped).`
        : `Dispatched to ${args.target} but uptake NOT confirmed. Target is ${currentTargetState} (heartbeat: ${flight.heartbeatAge}).${needsSpawn ? " Spawn required." : ""}`,
  };

  // Emit dispatch completion telemetry
  emitEvent(auth.userId, {
    event_type: "DISPATCH_COMPLETE",
    program_id: verifiedSource,
    target: args.target,
    task_id: taskId,
    directive_id: directiveId,
    target_state: currentTargetState,
    uptake_confirmed: uptakeConfirmed,
    wake_attempted: wakeAttempted,
    wake_result: wakeResultStr,
    success: response.success,
  });

  return jsonResult(response);
}
