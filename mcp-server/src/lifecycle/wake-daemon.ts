/**
 * Wake Daemon — Polls for orphaned tasks and spawns idle programs.
 * Phase 1: HTTP POST to host listener for tmux spawn.
 * Collection: users/{uid}/tasks (read), users/{uid}/sessions (read)
 */

import { getFirestore } from "../firebase/client.js";
import { SPAWNABLE_PROGRAMS, type ProgramLaunchConfig } from "../config/launch.js";
import { emitEvent } from "../modules/events.js";

export interface WakeDetail {
  programId: string;
  pendingTasks: number;
  action: "spawned" | "already_active" | "not_spawnable" | "spawn_failed" | "host_unreachable";
  error?: string;
}

export interface WakeResult {
  checked: number;
  woken: number;
  skipped: number;
  failed: number;
  hostReachable: boolean;
  details: WakeDetail[];
}

// Track consecutive host failures for ADD-003 health check
let consecutiveHostFailures = 0;
const HOST_FAILURE_ALERT_THRESHOLD = 3;

const WAKE_HOST_URL = process.env.WAKE_HOST_URL || "http://localhost:7777";

/**
 * Check if the wake host listener is reachable.
 * Returns true if healthy, false otherwise.
 */
async function checkHostHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${WAKE_HOST_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Attempt to spawn a program via the host listener.
 * POST {WAKE_HOST_URL}/spawn/{programId}
 */
async function spawnProgram(programId: string, config: ProgramLaunchConfig): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${WAKE_HOST_URL}/spawn/${programId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId,
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
 * Core wake daemon loop. Called by Cloud Scheduler every 60 seconds.
 * 1. Query tasks in created status, group by target
 * 2. For each target: check if active session exists
 * 3. If no session: attempt spawn via host listener
 * 4. Emit telemetry events
 */
export async function pollAndWake(userId: string): Promise<WakeResult> {
  const db = getFirestore();
  const result: WakeResult = {
    checked: 0,
    woken: 0,
    skipped: 0,
    failed: 0,
    hostReachable: true,
    details: [],
  };

  // Step 1: Find all created tasks grouped by target
  const tasksSnapshot = await db
    .collection(`users/${userId}/tasks`)
    .where("status", "==", "created")
    .limit(200)
    .get();

  if (tasksSnapshot.empty) {
    return result;
  }

  // Group by target program
  const tasksByTarget = new Map<string, number>();
  for (const doc of tasksSnapshot.docs) {
    const target = doc.data().target as string;
    if (target) {
      tasksByTarget.set(target, (tasksByTarget.get(target) || 0) + 1);
    }
  }

  result.checked = tasksByTarget.size;

  // Step 2: Check host health (ADD-003)
  const hostHealthy = await checkHostHealth();
  result.hostReachable = hostHealthy;

  if (!hostHealthy) {
    consecutiveHostFailures++;
    console.warn(`[WakeDaemon] Host unreachable (${consecutiveHostFailures} consecutive failures)`);

    // ADD-003: Alert after threshold
    if (consecutiveHostFailures >= HOST_FAILURE_ALERT_THRESHOLD) {
      emitEvent(userId, {
        event_type: "PROGRAM_WAKE",
        program_id: "wake-daemon",
        wake_action: "host_unreachable",
        consecutive_failures: consecutiveHostFailures,
      });
    }

    // Enter degraded mode — log all as skipped_host_down
    for (const [programId, count] of tasksByTarget) {
      result.details.push({
        programId,
        pendingTasks: count,
        action: "host_unreachable",
      });
      result.failed++;
    }
    return result;
  }

  // Reset consecutive failures on successful health check
  consecutiveHostFailures = 0;

  // Step 3: For each target, check for active sessions
  for (const [programId, pendingCount] of tasksByTarget) {
    const config = SPAWNABLE_PROGRAMS.get(programId);

    // Not a spawnable program
    if (!config) {
      result.details.push({
        programId,
        pendingTasks: pendingCount,
        action: "not_spawnable",
      });
      result.skipped++;
      continue;
    }

    // Check for active session
    const sessionsSnapshot = await db
      .collection(`users/${userId}/sessions`)
      .where("programId", "==", programId)
      .where("state", "in", ["working", "blocked"])
      .limit(1)
      .get();

    if (!sessionsSnapshot.empty) {
      result.details.push({
        programId,
        pendingTasks: pendingCount,
        action: "already_active",
      });
      result.skipped++;
      continue;
    }

    // No active session — attempt spawn
    const spawned = await spawnProgram(programId, config);

    if (spawned) {
      result.details.push({
        programId,
        pendingTasks: pendingCount,
        action: "spawned",
      });
      result.woken++;

      // Emit wake event
      emitEvent(userId, {
        event_type: "PROGRAM_WAKE",
        program_id: programId,
        pending_tasks: pendingCount,
        wake_action: "spawned",
      });
    } else {
      result.details.push({
        programId,
        pendingTasks: pendingCount,
        action: "spawn_failed",
        error: "Host listener returned non-OK response",
      });
      result.failed++;

      emitEvent(userId, {
        event_type: "PROGRAM_WAKE",
        program_id: programId,
        pending_tasks: pendingCount,
        wake_action: "spawn_failed",
      });
    }
  }

  return result;
}
