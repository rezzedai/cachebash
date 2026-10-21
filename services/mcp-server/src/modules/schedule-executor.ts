/**
 * Schedule Executor — Fires due schedules by creating tasks.
 * Called periodically from /v1/internal/execute-schedules endpoint in index.ts.
 *
 * For each tenant, queries schedules where enabled=true and nextRunAt <= now,
 * creates a task from the schedule's taskTemplate, and advances nextRunAt.
 *
 * A schedule with kind "watch" creates no task. It checks the tasks another
 * schedule made recently and writes one alert if they are all still unclaimed
 * (or if none exist). It runs from here -- a Cloud Scheduler job every minute --
 * so it needs no live session, which is the point: the alert goes to the user's
 * phone and Slack, not to a program.
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { emitEvent } from "./events.js";
import { computeNextRun } from "./schedule.js";
import { CONSTANTS } from "../config/constants.js";
import { writeAlertDocs } from "./signal.js";

export interface ScheduleFired {
  scheduleId: string;
  scheduleName: string;
  /** Null for a watch schedule, which creates no task. */
  taskId: string | null;
  target: string;
  /** Set when a watch schedule wrote an alert. */
  alertId?: string;
}

export interface ScheduleExecutionResult {
  checked: number;
  fired: ScheduleFired[];
  errors: number;
}

export async function executeSchedulesForUser(userId: string): Promise<ScheduleExecutionResult> {
  const db = getFirestore();
  const now = new Date();
  const fired: ScheduleFired[] = [];
  let errors = 0;

  // Query enabled schedules that are due (nextRunAt <= now)
  const dueSnap = await db.collection(`tenants/${userId}/schedules`)
    .where("enabled", "==", true)
    .where("nextRunAt", "<=", now.toISOString())
    .get();

  // Also query schedules with null nextRunAt (backfill/migration path)
  const nullSnap = await db.collection(`tenants/${userId}/schedules`)
    .where("enabled", "==", true)
    .where("nextRunAt", "==", null)
    .get();

  const allDocs = [...dueSnap.docs, ...nullSnap.docs];
  // Deduplicate by doc ID in case of overlap
  const seen = new Set<string>();
  const uniqueDocs = allDocs.filter(doc => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });

  for (const doc of uniqueDocs) {
    try {
      const result = await fireSchedule(db, userId, doc.ref, now);
      if (result) {
        fired.push(result);
      }
    } catch (err) {
      errors++;
      console.error(`[ScheduleExecutor] Failed to fire schedule ${doc.id} for user ${userId}:`, err);
    }
  }

  return { checked: uniqueDocs.length, fired, errors };
}

async function fireSchedule(
  db: FirebaseFirestore.Firestore,
  userId: string,
  scheduleRef: FirebaseFirestore.DocumentReference,
  now: Date,
): Promise<ScheduleFired | null> {
  return db.runTransaction(async (txn) => {
    const scheduleSnap = await txn.get(scheduleRef);
    if (!scheduleSnap.exists) return null;

    const schedule = scheduleSnap.data()!;

    // Re-verify the schedule is still due (prevents double-fire from concurrent runs)
    if (!schedule.enabled) return null;
    if (schedule.nextRunAt && schedule.nextRunAt > now.toISOString()) return null;

    // Missing kind means "task": every schedule written before kind existed.
    if (schedule.kind === "watch") {
      return fireWatch(db, userId, scheduleRef, schedule, now, txn);
    }

    const template = schedule.taskTemplate || {};

    // Create the task document. W2e: no expiresAt was ever written here -- every
    // fired schedule permanently added a field-less task doc. type:"task" with no
    // explicit ttl gets the same default create_task itself applies in that case
    // (CONSTANTS.ttl.defaultTaskSeconds, 24h), not the never-expires sentinel: this
    // is ordinary actionable work for `target`, not open-ended state like a sprint
    // or an unanswered question.
    const taskRef = db.collection(`tenants/${userId}/tasks`).doc();
    const taskDoc = {
      type: "task",
      title: template.title || schedule.name,
      instructions: template.instructions || null,
      target: schedule.target,
      source: "scheduler",
      action: template.action || "queue",
      priority: template.priority || "normal",
      status: "created",
      scheduleId: scheduleRef.id,
      scheduleName: schedule.name,
      createdAt: FieldValue.serverTimestamp(),
      ttl: CONSTANTS.ttl.defaultTaskSeconds,
      expiresAt: Timestamp.fromMillis(Date.now() + CONSTANTS.ttl.defaultTaskSeconds * 1000),
      // WP-1: scheduled work is actionable by default — a get_tasks() boot query
      // filtered on requires_action==true (WP-2) must never silently exclude a
      // fired schedule's task just because this writer bypasses the
      // classifyRequiresAction() helper in dispatch/tasks.ts.
      requires_action: true,
    };
    txn.create(taskRef, taskDoc);

    // Advance the schedule
    const nextRunAt = computeNextRun(schedule.cron);
    txn.update(scheduleRef, {
      lastRunAt: now.toISOString(),
      nextRunAt,
      updatedAt: now.toISOString(),
    });

    emitEvent(userId, {
      event_type: "SCHEDULE_FIRED",
      schedule_id: scheduleRef.id,
      schedule_name: schedule.name,
      task_id: taskRef.id,
      target: schedule.target,
      cron: schedule.cron,
    });

    return {
      scheduleId: scheduleRef.id,
      scheduleName: schedule.name,
      taskId: taskRef.id,
      target: schedule.target,
    };
  });
}

/**
 * Watch branch of fireSchedule, inside its transaction. Reads happen before any
 * write (Firestore requires it), and the caller's nextRunAt re-check already ran,
 * so a concurrent second fire never reaches here and writes no second alert.
 */
async function fireWatch(
  db: FirebaseFirestore.Firestore,
  userId: string,
  scheduleRef: FirebaseFirestore.DocumentReference,
  schedule: FirebaseFirestore.DocumentData,
  now: Date,
  txn: FirebaseFirestore.Transaction,
): Promise<ScheduleFired> {
  const watch = schedule.watch;
  if (!watch || typeof watch.scheduleId !== "string" || typeof watch.status !== "string" || !(watch.withinHours > 0)) {
    // A malformed watch must not look like a quiet pass. Throwing aborts the
    // transaction, nextRunAt stays due, and executeSchedulesForUser counts an error.
    throw new Error(`watch schedule ${scheduleRef.id} has no valid watch config`);
  }

  const cutoffMs = now.getTime() - watch.withinHours * 3600 * 1000;
  // Equality on scheduleId only (single-field index, no composite index to
  // deploy); the window is applied in memory. A task whose createdAt cannot be
  // read counts as inside the window so it can never be skipped silently.
  const tasksSnap = await txn.get(
    db.collection(`tenants/${userId}/tasks`).where("scheduleId", "==", watch.scheduleId),
  );
  const inWindow = tasksSnap.docs.filter((d) => {
    const createdAt = d.data().createdAt;
    const ms = createdAt && typeof createdAt.toMillis === "function" ? createdAt.toMillis() : null;
    return ms === null || ms >= cutoffMs;
  });

  let alertId: string | undefined;
  if (inWindow.length === 0) {
    // Silent absence: the watched schedule produced nothing. Never a pass.
    alertId = await writeAlertDocs(db, userId, {
      message: `Watched schedule ${watch.scheduleId} did not fire: no task created in the last ${watch.withinHours}h. ${watch.message ?? ""}`.trim(),
      alertType: "error",
      priority: "high",
      context: `watch:${scheduleRef.id} not_fired`,
      source: "watchdog",
      relayTarget: "slack-bridge",
    }, txn);
  } else if (inWindow.every((d) => d.data().status === watch.status)) {
    alertId = await writeAlertDocs(db, userId, {
      message: watch.message ?? `Tasks from schedule ${watch.scheduleId} are still ${watch.status}.`,
      alertType: "error",
      priority: "high",
      context: `watch:${scheduleRef.id} still_${watch.status}`,
      source: "watchdog",
      relayTarget: "slack-bridge",
    }, txn);
  }

  txn.update(scheduleRef, {
    lastRunAt: now.toISOString(),
    nextRunAt: computeNextRun(schedule.cron),
    updatedAt: now.toISOString(),
  });

  emitEvent(userId, {
    event_type: "SCHEDULE_FIRED",
    schedule_id: scheduleRef.id,
    schedule_name: schedule.name,
    target: schedule.target,
    cron: schedule.cron,
    watch_alerted: alertId !== undefined,
  });

  return {
    scheduleId: scheduleRef.id,
    scheduleName: schedule.name,
    taskId: null,
    target: schedule.target,
    ...(alertId ? { alertId } : {}),
  };
}
