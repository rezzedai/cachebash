/**
 * Schedule Executor — Fires due schedules by creating tasks.
 * Called periodically from /v1/internal/execute-schedules endpoint in index.ts.
 *
 * For each tenant, queries schedules where enabled=true and nextRunAt <= now,
 * creates a task from the schedule's taskTemplate, and advances nextRunAt.
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import { emitEvent } from "./events.js";
import { computeNextRun } from "./schedule.js";

export interface ScheduleFired {
  scheduleId: string;
  scheduleName: string;
  taskId: string;
  target: string;
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

    const template = schedule.taskTemplate || {};

    // Create the task document
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
