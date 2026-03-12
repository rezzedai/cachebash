/**
 * On-Demand Wake Module — Targeted program spawn with debounce.
 *
 * Called by the dispatch() handler when a target program is stale/absent.
 * Also exposed as an HTTP endpoint for external triggers.
 *
 * Key differences from the scheduled wake daemon (lifecycle/wake-daemon.ts):
 * - Targets a SINGLE program (not a sweep of all programs)
 * - Has Firestore-backed spawn debounce (no re-spawn within 60s)
 * - Polls heartbeat for confirmation (returns when program is alive)
 * - Returns structured result for dispatch() response composition
 */

import { getFirestore } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { SPAWNABLE_PROGRAMS, type ProgramLaunchConfig } from "../../config/launch.js";
import { emitEvent } from "../events.js";

const WAKE_HOST_URL = process.env.WAKE_HOST_URL || "http://localhost:7777";

/** Minimum seconds between spawn attempts for the same program */
const SPAWN_DEBOUNCE_SECONDS = 60;

/** Maximum time to wait for a program to come alive after spawn */
const WAKE_POLL_TIMEOUT_MS = 30_000;

/** Polling interval while waiting for heartbeat */
const WAKE_POLL_INTERVAL_MS = 5_000;

/** Stale threshold: 30 minutes */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export type WakeOutcome =
  | "success"         // Program came alive within timeout
  | "spawned_pending" // Spawn triggered, but program not yet alive
  | "debounced"       // Recent spawn exists, skipping
  | "not_spawnable"   // Program not in SPAWNABLE_PROGRAMS
  | "host_unreachable"// Wake host listener not responding
  | "timeout"         // Spawn triggered, but program didn't come alive in time
  | "already_alive";  // Program was already alive

export type TargetState = "alive" | "stale" | "absent";

export interface WakeRequest {
  userId: string;
  target: string;
  /** If true, wait for program heartbeat confirmation */
  waitForAlive?: boolean;
  /** Caller context for telemetry */
  callerSource?: string;
  /** Task ID that triggered this wake (for context) */
  taskId?: string;
}

export interface WakeResponse {
  outcome: WakeOutcome;
  targetState: TargetState;
  heartbeatAge: string;
  heartbeatAgeMs: number;
  programId: string;
  spawnConfig: ProgramLaunchConfig | null;
  debounceRemainingSeconds?: number;
  message: string;
}

/** Format milliseconds as human-readable age string */
function formatAge(ms: number): string {
  if (ms === Infinity || ms < 0) return "never";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Query target program's heartbeat from the _meta/programs subcollection.
 */
async function getTargetHeartbeat(
  userId: string,
  target: string,
): Promise<{ state: TargetState; ageMs: number; sessionId: string | null }> {
  const db = getFirestore();
  const programDoc = await db.doc(`tenants/${userId}/sessions/_meta/programs/${target}`).get();

  if (!programDoc.exists) {
    return { state: "absent", ageMs: Infinity, sessionId: null };
  }

  const data = programDoc.data()!;
  const heartbeatTime = data.lastHeartbeat?.toDate?.()
    ? data.lastHeartbeat.toDate().getTime()
    : 0;

  if (heartbeatTime === 0) {
    return { state: "absent", ageMs: Infinity, sessionId: data.currentSessionId || null };
  }

  const ageMs = Date.now() - heartbeatTime;
  return {
    state: ageMs < STALE_THRESHOLD_MS ? "alive" : "stale",
    ageMs,
    sessionId: data.currentSessionId || null,
  };
}

/**
 * Check spawn debounce — has this program been spawned recently?
 * Uses Firestore doc at tenants/{uid}/wake_debounce/{programId}.
 * Returns remaining debounce seconds, or 0 if clear to spawn.
 */
async function checkDebounce(userId: string, target: string): Promise<number> {
  const db = getFirestore();
  const ref = db.doc(`tenants/${userId}/wake_debounce/${target}`);
  const doc = await ref.get();

  if (!doc.exists) return 0;

  const data = doc.data()!;
  const spawnedAt = data.spawnedAt?.toDate?.()?.getTime() || 0;
  if (spawnedAt === 0) return 0;

  const elapsed = (Date.now() - spawnedAt) / 1000;
  const remaining = SPAWN_DEBOUNCE_SECONDS - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

/**
 * Record a spawn attempt for debounce tracking.
 */
async function recordSpawn(userId: string, target: string, taskId?: string): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`tenants/${userId}/wake_debounce/${target}`);
  await ref.set({
    programId: target,
    spawnedAt: admin.firestore.FieldValue.serverTimestamp(),
    taskId: taskId || null,
    // Auto-expire after 5 minutes (cleanup)
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
  });
}

/**
 * Attempt to spawn a program via the wake host listener.
 */
async function triggerSpawn(target: string, config: ProgramLaunchConfig): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${WAKE_HOST_URL}/spawn/${target}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId: target,
        repo: config.repo,
        model: config.model,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll heartbeat until program comes alive or timeout.
 */
async function pollUntilAlive(
  userId: string,
  target: string,
  timeoutMs: number = WAKE_POLL_TIMEOUT_MS,
): Promise<{ alive: boolean; ageMs: number }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(WAKE_POLL_INTERVAL_MS);
    const hb = await getTargetHeartbeat(userId, target);
    if (hb.state === "alive") {
      return { alive: true, ageMs: hb.ageMs };
    }
  }

  // Final check
  const final = await getTargetHeartbeat(userId, target);
  return { alive: final.state === "alive", ageMs: final.ageMs };
}

// ─── MAIN FUNCTION ───────────────────────────────────────────────────────────

/**
 * On-demand targeted wake for a single program.
 *
 * Flow:
 * 1. Check current heartbeat — if alive, return immediately
 * 2. Check spawn debounce — if recently spawned, return with debounce info
 * 3. Look up spawn config — if not spawnable, return error
 * 4. Trigger spawn via host listener
 * 5. Record spawn for debounce
 * 6. Optionally poll for heartbeat confirmation
 * 7. Return structured result
 */
export async function wakeTarget(req: WakeRequest): Promise<WakeResponse> {
  const { userId, target, waitForAlive = true, callerSource, taskId } = req;

  // 1. Check current state
  const hb = await getTargetHeartbeat(userId, target);

  if (hb.state === "alive") {
    return {
      outcome: "already_alive",
      targetState: "alive",
      heartbeatAge: formatAge(hb.ageMs),
      heartbeatAgeMs: hb.ageMs,
      programId: target,
      spawnConfig: SPAWNABLE_PROGRAMS.get(target) || null,
      message: `${target} is already alive (heartbeat: ${formatAge(hb.ageMs)}).`,
    };
  }

  // 2. Check spawn config
  const config = SPAWNABLE_PROGRAMS.get(target);
  if (!config) {
    return {
      outcome: "not_spawnable",
      targetState: hb.state,
      heartbeatAge: formatAge(hb.ageMs),
      heartbeatAgeMs: hb.ageMs,
      programId: target,
      spawnConfig: null,
      message: `${target} is not in the spawnable programs list.`,
    };
  }

  // 3. Check debounce
  const debounceRemaining = await checkDebounce(userId, target);
  if (debounceRemaining > 0) {
    return {
      outcome: "debounced",
      targetState: hb.state,
      heartbeatAge: formatAge(hb.ageMs),
      heartbeatAgeMs: hb.ageMs,
      programId: target,
      spawnConfig: config,
      debounceRemainingSeconds: debounceRemaining,
      message: `${target} was recently spawned. Debounce: ${debounceRemaining}s remaining. Task is queued for pickup.`,
    };
  }

  // 4. Trigger spawn
  const spawned = await triggerSpawn(target, config);

  if (!spawned) {
    // Emit failure telemetry
    emitEvent(userId, {
      event_type: "PROGRAM_WAKE",
      program_id: target,
      wake_action: "spawn_failed",
      caller_source: callerSource,
      task_id: taskId,
    });

    return {
      outcome: "host_unreachable",
      targetState: hb.state,
      heartbeatAge: formatAge(hb.ageMs),
      heartbeatAgeMs: hb.ageMs,
      programId: target,
      spawnConfig: config,
      message: `Wake host unreachable or spawn failed for ${target}. Host: ${WAKE_HOST_URL}`,
    };
  }

  // 5. Record spawn for debounce
  await recordSpawn(userId, target, taskId);

  // Emit spawn telemetry
  emitEvent(userId, {
    event_type: "PROGRAM_WAKE",
    program_id: target,
    wake_action: "spawned",
    caller_source: callerSource,
    task_id: taskId,
  });

  // 6. Wait for alive (if requested)
  if (waitForAlive) {
    const poll = await pollUntilAlive(userId, target);

    if (poll.alive) {
      return {
        outcome: "success",
        targetState: "alive",
        heartbeatAge: formatAge(poll.ageMs),
        heartbeatAgeMs: poll.ageMs,
        programId: target,
        spawnConfig: config,
        message: `${target} spawned and alive (heartbeat: ${formatAge(poll.ageMs)}).`,
      };
    }

    return {
      outcome: "timeout",
      targetState: "stale",
      heartbeatAge: formatAge(hb.ageMs),
      heartbeatAgeMs: hb.ageMs,
      programId: target,
      spawnConfig: config,
      message: `${target} spawn triggered but not alive within ${WAKE_POLL_TIMEOUT_MS / 1000}s. Task is queued.`,
    };
  }

  // 7. Fire-and-forget mode
  return {
    outcome: "spawned_pending",
    targetState: "stale",
    heartbeatAge: formatAge(hb.ageMs),
    heartbeatAgeMs: hb.ageMs,
    programId: target,
    spawnConfig: config,
    message: `${target} spawn triggered (not waiting for confirmation). Task is queued.`,
  };
}

/**
 * Convenience: query heartbeat state only (no spawn).
 * Used by enrichment functions for send_directive / create_task.
 */
export async function queryTargetState(
  userId: string,
  target: string,
): Promise<{ targetState: TargetState; heartbeatAge: string; heartbeatAgeMs: number }> {
  const hb = await getTargetHeartbeat(userId, target);
  return {
    targetState: hb.state,
    heartbeatAge: formatAge(hb.ageMs),
    heartbeatAgeMs: hb.ageMs,
  };
}
