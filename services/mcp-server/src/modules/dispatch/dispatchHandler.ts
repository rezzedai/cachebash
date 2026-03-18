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
import { checkGovernanceRules } from "./governance.js";
import { isProgramPaused, isProgramQuarantined } from "../pulse.js";
import { evaluatePolicies } from "../policy.js";

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
  policy_mode: z.enum(["normal", "supervised", "strict"]).default("normal"),
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

// ─── WAVE 16: TARGET SUGGESTION ──────────────────────────────────────────────

interface TargetSuggestion {
  programId: string;
  successRate: number;
  sampleSize: number;
  reason: string;
}

/**
 * Suggest a better target based on historical success rates.
 * Returns a suggestion only if an alternative has >20% higher success rate AND >5 completions.
 */
async function suggestBetterTarget(
  userId: string,
  context: { currentTarget: string; taskType: string; title: string }
): Promise<TargetSuggestion | null> {
  const db = getFirestore();

  // Query all program stats
  const statsSnapshot = await db.collection(`tenants/${userId}/program_stats`).get();

  if (statsSnapshot.empty) {
    return null; // No stats available
  }

  // Calculate success rate for current target
  let currentSuccessRate = 0;
  const currentDoc = statsSnapshot.docs.find((doc) => doc.id === context.currentTarget);
  if (currentDoc) {
    const data = currentDoc.data();
    const taskTypeStats = data.taskTypeSuccessRates?.[context.taskType];
    if (taskTypeStats && taskTypeStats.total > 0) {
      currentSuccessRate = taskTypeStats.success / taskTypeStats.total;
    }
  }

  // Find alternatives with better success rates
  let bestAlternative: { programId: string; successRate: number; sampleSize: number } | null = null;

  for (const doc of statsSnapshot.docs) {
    const programId = doc.id;
    if (programId === context.currentTarget) continue; // Skip current target

    // Check if program is paused or quarantined
    const isPaused = await isProgramPaused(userId, programId);
    const isQuarantined = await isProgramQuarantined(userId, programId);
    if (isPaused || isQuarantined) continue; // Skip unavailable programs

    const data = doc.data();
    const taskTypeStats = data.taskTypeSuccessRates?.[context.taskType];

    if (!taskTypeStats || taskTypeStats.total < 5) {
      continue; // Need at least 5 completions
    }

    const successRate = taskTypeStats.success / taskTypeStats.total;

    // Check if success rate is >20% higher
    if (successRate > currentSuccessRate + 0.2) {
      if (!bestAlternative || successRate > bestAlternative.successRate) {
        bestAlternative = {
          programId,
          successRate,
          sampleSize: taskTypeStats.total,
        };
      }
    }
  }

  if (!bestAlternative) {
    return null; // No better alternative found
  }

  return {
    programId: bestAlternative.programId,
    successRate: bestAlternative.successRate,
    sampleSize: bestAlternative.sampleSize,
    reason: `${Math.round(bestAlternative.successRate * 100)}% success rate for ${context.taskType} tasks (${bestAlternative.sampleSize} completions) vs ${Math.round(currentSuccessRate * 100)}% for ${context.currentTarget}`,
  };
}

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
    policy_mode: args.policy_mode,
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

  // ── 0. GOVERNANCE PRE-FLIGHT (soft checks) ──
  const governance = checkGovernanceRules({
    instructions: args.instructions,
    action: args.action,
    title: args.title,
  });

  // ── 0.5. POLICY ENGINE EVALUATION ──
  const policyEvaluations = await evaluatePolicies(auth, {
    instructions: args.instructions,
    title: args.title,
    target: args.target,
    source: verifiedSource,
    action: args.action,
    priority: args.priority,
    projectId: args.projectId,
  });

  const matchedPolicies = policyEvaluations.filter((e) => e.matched);
  const warnings = matchedPolicies.filter((e) => e.enforcement === "warn");
  const blockers = matchedPolicies.filter((e) => e.enforcement === "block");
  const approvals = matchedPolicies.filter((e) => e.enforcement === "require_approval");

  // Add policy warnings to governance warnings
  for (const warning of warnings) {
    governance.warnings.push(`[${warning.policyId}] ${warning.message}`);
  }

  // Block if any blocking policies matched
  if (blockers.length > 0) {
    return jsonResult({
      success: false,
      error: "Dispatch blocked by policy violation",
      policy_violations: blockers.map((b) => ({
        policyId: b.policyId,
        policyName: b.policyName,
        enforcement: b.enforcement,
        severity: b.severity,
        message: b.message,
      })),
      message: `Dispatch blocked by ${blockers.length} policy violation(s): ${blockers.map((b) => b.policyName).join(", ")}`,
    });
  }

  // Add approval-required warnings
  for (const approval of approvals) {
    governance.warnings.push(`[approval_required:${approval.policyId}] ${approval.message}`);
  }

  // Check if target program is paused
  const targetPaused = await isProgramPaused(auth.userId, args.target);
  if (targetPaused) {
    governance.warnings.push(
      `[target_paused] Target program "${args.target}" is paused. Task will be created but target won't receive it until resumed. Consider using pulse_resume_program first.`
    );
  }

  // Check if target program is quarantined
  const targetQuarantined = await isProgramQuarantined(auth.userId, args.target);
  if (targetQuarantined) {
    governance.warnings.push(
      `[target_quarantined] Target program "${args.target}" is quarantined. Dispatch blocked. Use dispatch_unquarantine_program to restore.`
    );
  }

  // Strict policy mode enforcement: governance warnings become blocking errors
  if (args.policy_mode === "strict" && governance.warnings.length > 0) {
    return jsonResult({
      success: false,
      error: "Strict policy violation: governance warnings present",
      governance_warnings: governance.warnings,
      policy_violations: matchedPolicies.length > 0
        ? matchedPolicies.map((p) => ({
            policyId: p.policyId,
            policyName: p.policyName,
            enforcement: p.enforcement,
            severity: p.severity,
            message: p.message,
          }))
        : undefined,
      message: `Dispatch blocked by strict policy mode. Violations: ${governance.warnings.join("; ")}`,
    });
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

  // ── 2.5. WAVE 16: TARGET SUGGESTION (advisory only, before send) ──
  let suggestedTarget: string | undefined;
  let suggestionReason: string | undefined;

  try {
    const suggestion = await suggestBetterTarget(auth.userId, {
      currentTarget: args.target,
      taskType: "task", // Default type
      title: args.title,
    });

    if (suggestion) {
      suggestedTarget = suggestion.programId;
      suggestionReason = suggestion.reason;

      // Add suggestion to governance warnings
      governance.warnings.push(
        `[target_suggestion] Consider dispatching to "${suggestion.programId}" instead: ${suggestion.reason}`
      );
    }
  } catch (err) {
    console.error("[TargetSuggestion] Failed to suggest target:", err);
    // Non-blocking — continue with original target
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

  // Override success if target is paused or quarantined
  const successResult = targetPaused || targetQuarantined
    ? false
    : uptakeConfirmed || (currentTargetState === "alive" && !args.waitForUptake);

  const response: DispatchResponse = {
    success: successResult,
    taskId,
    directiveId,
    targetState: currentTargetState,
    uptakeConfirmed: targetPaused || targetQuarantined ? false : uptakeConfirmed,
    claimedBy,
    claimedAt,
    heartbeatAge: flight.heartbeatAge,
    wakeAttempted: wakeAttempted || undefined,
    wakeResult: wakeAttempted ? wakeResultStr : undefined,
    action_required: targetQuarantined
      ? "unquarantine"
      : needsSpawn
        ? "spawn_target"
        : uptakeConfirmed && !targetPaused
          ? "none"
          : "retry",
    spawnSpec: needsSpawn && spawnConfig
      ? {
          programId: args.target,
          model: spawnConfig.model,
          repo: spawnConfig.repo,
          description: spawnConfig.description,
        }
      : undefined,
    message: targetQuarantined
      ? `Task created but target "${args.target}" is QUARANTINED. Dispatch blocked. Use dispatch_unquarantine_program to restore.`
      : targetPaused
        ? `Task created but target "${args.target}" is PAUSED. Task will remain queued until target is resumed.`
        : uptakeConfirmed
          ? `Dispatched to ${args.target} — task claimed${claimedBy ? ` by ${claimedBy}` : ""}.`
          : currentTargetState === "alive" && !args.waitForUptake
            ? `Dispatched to ${args.target} (alive, uptake check skipped).`
            : `Dispatched to ${args.target} but uptake NOT confirmed. Target is ${currentTargetState} (heartbeat: ${flight.heartbeatAge}).${needsSpawn ? " Spawn required." : ""}`,
    governance_warnings: governance.warnings.length > 0 ? governance.warnings : undefined,
    policy_violations:
      matchedPolicies.length > 0
        ? matchedPolicies.map((p) => ({
            policyId: p.policyId,
            policyName: p.policyName,
            enforcement: p.enforcement,
            severity: p.severity,
            message: p.message,
          }))
        : undefined,
    suggested_target: suggestedTarget,
    suggestion_reason: suggestionReason,
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
    governance_warnings_count: governance.warnings.length,
  });

  return jsonResult(response);
}
