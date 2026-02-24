/**
 * Health Monitoring Module
 *
 * Runs health checks against Firestore data and emits alerts based on thresholds.
 * Critical alerts route to admin's mobile (via relay + tasks mirror).
 * Warning alerts route to orchestrator (via relay STATUS message).
 */

import * as admin from "firebase-admin";
import { getFirestore } from "../firebase/client.js";
import { emitEvent } from "./events.js";

export interface HealthIndicator {
  name: string;
  value: number;
  status: "ok" | "warning" | "critical";
  threshold: { warning: number; critical: number };
}

export interface HealthCheckResult {
  timestamp: string;
  overall_status: "ok" | "warning" | "critical";
  indicators: HealthIndicator[];
  alerts_sent: string[];
}

export async function runHealthCheck(
  userId: string,
  db?: admin.firestore.Firestore
): Promise<HealthCheckResult> {
    const firestore = db || getFirestore();
  const now = admin.firestore.Timestamp.now();
  const oneHourAgo = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() - 60 * 60 * 1000)
  );
  const thirtyMinAgo = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() - 30 * 60 * 1000)
  );

  const indicators: HealthIndicator[] = [];
  const alertsSent: string[] = [];

  // 1. Task failure rate (failed / total in last hour)
  const recentTasks = await firestore
    .collection(`tenants/${userId}/tasks`)
    .where("completedAt", ">=", oneHourAgo)
    .get();

  const totalTasks = recentTasks.size;
  const failedTasks = recentTasks.docs.filter(
    (d) => d.data().completed_status === "FAILED"
  ).length;
  const failureRate = totalTasks > 0 ? failedTasks / totalTasks : 0;

  indicators.push({
    name: "task_failure_rate",
    value: Math.round(failureRate * 100) / 100,
    status: failureRate > 0.5 ? "critical" : failureRate > 0.2 ? "warning" : "ok",
    threshold: { warning: 0.2, critical: 0.5 },
  });

  // 2. Session death count (SESSION_DEATH events in last hour)
  const deathEvents = await firestore
    .collection(`tenants/${userId}/events`)
    .where("event_type", "==", "SESSION_DEATH")
    .where("timestamp", ">=", oneHourAgo)
    .get();

  indicators.push({
    name: "session_death_count",
    value: deathEvents.size,
    status: deathEvents.size > 10 ? "critical" : deathEvents.size > 3 ? "warning" : "ok",
    threshold: { warning: 3, critical: 10 },
  });

  // 3. Stale task count (tasks in created status > 30 min)
  const staleTasks = await firestore
    .collection(`tenants/${userId}/tasks`)
    .where("status", "==", "created")
    .where("createdAt", "<=", thirtyMinAgo)
    .get();

  indicators.push({
    name: "stale_task_count",
    value: staleTasks.size,
    status: staleTasks.size > 15 ? "critical" : staleTasks.size > 5 ? "warning" : "ok",
    threshold: { warning: 5, critical: 15 },
  });

  // 4. Relay queue depth (pending relay messages)
  const pendingRelay = await firestore
    .collection(`tenants/${userId}/relay`)
    .where("status", "==", "pending")
    .get();

  indicators.push({
    name: "relay_queue_depth",
    value: pendingRelay.size,
    status: pendingRelay.size > 50 ? "critical" : pendingRelay.size > 20 ? "warning" : "ok",
    threshold: { warning: 20, critical: 50 },
  });

  // 5. Wake failure rate (failed wake attempts in last hour)
  const wakeEvents = await firestore
    .collection(`tenants/${userId}/events`)
    .where("event_type", "==", "PROGRAM_WAKE")
    .where("timestamp", ">=", oneHourAgo)
    .get();

  const failedWakes = wakeEvents.docs.filter(
    (d) => d.data().wake_result === "failed" || d.data().error
  ).length;

  indicators.push({
    name: "wake_failure_count",
    value: failedWakes,
    status: failedWakes > 5 ? "critical" : failedWakes > 2 ? "warning" : "ok",
    threshold: { warning: 2, critical: 5 },
  });

  // 6. Cleanup backlog (expired but uncleaned relay messages)
  const expiredRelay = await firestore
    .collection(`tenants/${userId}/relay`)
    .where("status", "==", "pending")
    .where("expiresAt", "<=", now)
    .get();

  indicators.push({
    name: "cleanup_backlog",
    value: expiredRelay.size,
    status: expiredRelay.size > 50 ? "critical" : expiredRelay.size > 10 ? "warning" : "ok",
    threshold: { warning: 10, critical: 50 },
  });

  // Determine overall status
  const hasCritical = indicators.some((i) => i.status === "critical");
  const hasWarning = indicators.some((i) => i.status === "warning");
  const overallStatus = hasCritical ? "critical" : hasWarning ? "warning" : "ok";

  // Route alerts
  if (hasCritical) {
    // Critical: send mobile alert to admin
    try {
      const criticalIndicators = indicators.filter((i) => i.status === "critical");
      const alertMessage = `HEALTH CRITICAL: ${criticalIndicators
        .map((i) => `${i.name}=${i.value}`)
        .join(", ")}`;

      const alertDoc = {
        message: alertMessage,
        alertType: "error",
        priority: "high",
        source: "gridbot",
        target: "admin",
        status: "pending",
        type: "alert",
        expiresAt: admin.firestore.Timestamp.fromDate(
          new Date(now.toDate().getTime() + 3600 * 1000)
        ),
        createdAt: now,
      };

      // Write to relay for alert feed
      await firestore.collection(`tenants/${userId}/relay`).add(alertDoc);

      // Mirror to tasks for mobile visibility
      await firestore.collection(`tenants/${userId}/tasks`).add({
        ...alertDoc,
        title: "[GRIDBOT] Health Critical Alert",
        instructions: alertMessage,
      });

      alertsSent.push("HEALTH_CRITICAL alert to admin (mobile)");
    } catch (err) {
      console.error("[GRIDBOT] Failed to send critical alert:", err);
    }

    emitEvent(userId, {
      event_type: "HEALTH_CRITICAL",
      program_id: "gridbot",
      indicators: indicators
        .filter((i) => i.status === "critical")
        .map((i) => ({ name: i.name, value: i.value })),
    });
  }

  if (hasWarning) {
    // Warning: relay message to orchestrator
    try {
      const warningIndicators = indicators.filter((i) => i.status === "warning");
      const warningMessage = `HEALTH WARNING: ${warningIndicators
        .map((i) => `${i.name}=${i.value}`)
        .join(", ")}`;

      await firestore.collection(`tenants/${userId}/relay`).add({
        message: warningMessage,
        source: "gridbot",
        target: "orchestrator",
        message_type: "STATUS",
        status: "pending",
        priority: "normal",
        createdAt: now,
        expiresAt: admin.firestore.Timestamp.fromDate(
          new Date(now.toDate().getTime() + 3600 * 1000)
        ),
      });

      alertsSent.push("HEALTH_WARNING status to orchestrator");
    } catch (err) {
      console.error("[GRIDBOT] Failed to send warning:", err);
    }

    emitEvent(userId, {
      event_type: "HEALTH_WARNING",
      program_id: "gridbot",
      indicators: indicators
        .filter((i) => i.status === "warning")
        .map((i) => ({ name: i.name, value: i.value })),
    });
  }

  // Write health check result to Firestore for historical trending
  const result: HealthCheckResult = {
    timestamp: now.toDate().toISOString(),
    overall_status: overallStatus,
    indicators,
    alerts_sent: alertsSent,
  };

  try {
    await firestore.collection(`tenants/${userId}/health_checks`).add({
      ...result,
      timestamp: now,
    });
  } catch (err) {
    console.error("[GRIDBOT] Failed to write health check:", err);
  }

  return result;
}
