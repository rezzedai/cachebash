/**
 * Stale Session Detector — Identifies and archives sessions with no recent heartbeat.
 * Called periodically from /v1/internal/stale-sessions endpoint in index.ts.
 *
 * Thresholds:
 * - Warn at 10 minutes without heartbeat → Create ISO task
 * - Auto-archive at 30 minutes without heartbeat
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { emitEvent } from "./events.js";
import { getComplianceConfig } from "../config/compliance.js";

export interface StaleSession {
  sessionId: string;
  programId: string;
  lastHeartbeat: string;
  ageMinutes: number;
  action: "warned" | "archived" | "iso_alerted";
}

export interface StaleSessionResult {
  checked: number;
  stale: StaleSession[];
  archived: number;
  isoAlertsCreated: number;
}

const STALE_WARN_THRESHOLD_MS = 10 * 60 * 1000;     // 10 minutes (default)

export async function detectStaleSessions(userId: string): Promise<StaleSessionResult> {
  const db = getFirestore();
  const now = Date.now();

  // W1.2.5: Use compliance config for staleness threshold
  const complianceConfig = getComplianceConfig(userId);
  const stalenessThresholdMs = complianceConfig.contextHealth.enabled
    ? complianceConfig.contextHealth.stalenessThresholdMinutes * 60 * 1000
    : 30 * 60 * 1000; // Default to 30 minutes if disabled

  const sessionsSnap = await db.collection(`tenants/${userId}/sessions`)
    .where("state", "in", ["working", "blocked"])
    .get();

  const stale: StaleSession[] = [];
  let archived = 0;
  let isoAlertsCreated = 0;

  for (const doc of sessionsSnap.docs) {
    const data = doc.data();

    // Skip pinned sessions
    if (data.state === "pinned") continue;

    const heartbeatTime = data.lastHeartbeat?.toDate?.() || data.lastUpdate?.toDate?.();
    const heartbeatMs = heartbeatTime ? heartbeatTime.getTime() : 0;
    const ageMs = now - heartbeatMs;

    // W1.2.5: Use configurable threshold for staleness detection
    if (ageMs > stalenessThresholdMs) {
      // Auto-archive: session is dead
      try {
        await doc.ref.update({
          state: "complete",
          archived: true,
          archivedReason: "stale_session_auto_archived",
          archivedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error(`[StaleSessions] Failed to archive ${doc.id}:`, err);
        continue;
      }

      emitEvent(userId, {
        event_type: "SESSION_DEATH",
        session_id: doc.id,
        program_id: data.programId || "unknown",
        lastHeartbeat: heartbeatTime?.toISOString() || null,
        ageMinutes: Math.round(ageMs / 60000),
        action: "auto_archived",
      });

      stale.push({
        sessionId: doc.id,
        programId: data.programId || "unknown",
        lastHeartbeat: heartbeatTime?.toISOString() || "never",
        ageMinutes: Math.round(ageMs / 60000),
        action: "archived",
      });
      archived++;
    } else if (ageMs > STALE_WARN_THRESHOLD_MS) {
      // Warn: session may be hanging/stuck
      emitEvent(userId, {
        event_type: "HEALTH_WARNING",
        program_id: data.programId || "unknown",
        indicator: "stale_session",
        session_id: doc.id,
        lastHeartbeat: heartbeatTime?.toISOString() || null,
        ageMinutes: Math.round(ageMs / 60000),
      });

      // Create ISO alert task for stuck session (only if not already alerted)
      if (!data.stuckSessionAlertSent) {
        try {
          await createStuckSessionAlert(userId, {
            sessionId: doc.id,
            programId: data.programId || "unknown",
            sessionName: data.name || doc.id,
            lastHeartbeat: heartbeatTime?.toISOString() || "never",
            ageMinutes: Math.round(ageMs / 60000),
          });

          // Mark session as alerted to prevent duplicates
          await doc.ref.update({
            stuckSessionAlertSent: true,
            stuckSessionAlertAt: FieldValue.serverTimestamp(),
          });

          isoAlertsCreated++;

          stale.push({
            sessionId: doc.id,
            programId: data.programId || "unknown",
            lastHeartbeat: heartbeatTime?.toISOString() || "never",
            ageMinutes: Math.round(ageMs / 60000),
            action: "iso_alerted",
          });
        } catch (err) {
          console.error(`[StaleSessions] Failed to create ISO alert for ${doc.id}:`, err);
          // Still record as warned even if alert fails
          stale.push({
            sessionId: doc.id,
            programId: data.programId || "unknown",
            lastHeartbeat: heartbeatTime?.toISOString() || "never",
            ageMinutes: Math.round(ageMs / 60000),
            action: "warned",
          });
        }
      } else {
        // Already alerted, just track as warned
        stale.push({
          sessionId: doc.id,
          programId: data.programId || "unknown",
          lastHeartbeat: heartbeatTime?.toISOString() || "never",
          ageMinutes: Math.round(ageMs / 60000),
          action: "warned",
        });
      }
    }
  }

  return { checked: sessionsSnap.size, stale, archived, isoAlertsCreated };
}

/**
 * Creates an alert task for ISO about a stuck session
 */
async function createStuckSessionAlert(
  userId: string,
  session: {
    sessionId: string;
    programId: string;
    sessionName: string;
    lastHeartbeat: string;
    ageMinutes: number;
  }
): Promise<void> {
  const db = getFirestore();
  const expiresAt = Timestamp.fromMillis(Date.now() + 3600 * 1000); // 1 hour TTL

  const alertMessage = `Session STUCK: ${session.programId} session "${session.sessionName}" has been silent for ${session.ageMinutes} minutes.\n\nSession ID: ${session.sessionId}\nLast heartbeat: ${session.lastHeartbeat}\n\nThis session is alive but producing no output. It may be deadlocked, waiting indefinitely, or experiencing other issues.`;

  const alertDoc = {
    message: alertMessage,
    alertType: "warning",
    priority: "high",
    source: "stale-session-detector",
    target: "iso",
    status: "pending",
    type: "alert",
    expiresAt,
    sessionId: session.sessionId,
    programId: session.programId,
    createdAt: FieldValue.serverTimestamp(),
  };

  // Write to relay collection
  const relayRef = await db.collection(`tenants/${userId}/relay`).add(alertDoc);

  // Mirror to tasks collection for mobile visibility and ISO task queue
  await db.collection(`tenants/${userId}/tasks`).doc(relayRef.id).set({
    schemaVersion: '2.2' as const,
    type: "task",
    title: `[STUCK SESSION] ${session.programId} - ${session.ageMinutes}min silent`,
    instructions: alertMessage,
    preview: `Session ${session.sessionId} stuck for ${session.ageMinutes}min`,
    source: "stale-session-detector",
    target: "iso",
    priority: "high",
    action: "queue",
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    metadata: {
      sessionId: session.sessionId,
      programId: session.programId,
      ageMinutes: session.ageMinutes,
      alertType: "stuck_session",
    },
  });

  console.log(`[StaleSessions] Created ISO alert for stuck session ${session.sessionId} (${session.programId}, ${session.ageMinutes}min)`);
}
