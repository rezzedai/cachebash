/**
 * Stale Session Detector — Identifies and archives sessions with no recent heartbeat.
 * Called periodically from /v1/internal/stale-sessions endpoint in index.ts.
 *
 * Thresholds:
 * - Warn at 10 minutes without heartbeat
 * - Auto-archive at 30 minutes without heartbeat
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import { emitEvent } from "./events.js";

export interface StaleSession {
  sessionId: string;
  programId: string;
  lastHeartbeat: string;
  ageMinutes: number;
  action: "warned" | "archived";
}

export interface StaleSessionResult {
  checked: number;
  stale: StaleSession[];
  archived: number;
}

const STALE_WARN_THRESHOLD_MS = 10 * 60 * 1000;     // 10 minutes
const STALE_ARCHIVE_THRESHOLD_MS = 30 * 60 * 1000;  // 30 minutes

export async function detectStaleSessions(userId: string): Promise<StaleSessionResult> {
  const db = getFirestore();
  const now = Date.now();

  const sessionsSnap = await db.collection(`tenants/${userId}/sessions`)
    .where("state", "in", ["working", "blocked"])
    .get();

  const stale: StaleSession[] = [];
  let archived = 0;

  for (const doc of sessionsSnap.docs) {
    const data = doc.data();

    // Skip pinned sessions
    if (data.state === "pinned") continue;

    const heartbeatTime = data.lastHeartbeat?.toDate?.() || data.lastUpdate?.toDate?.();
    const heartbeatMs = heartbeatTime ? heartbeatTime.getTime() : 0;
    const ageMs = now - heartbeatMs;

    if (ageMs > STALE_ARCHIVE_THRESHOLD_MS) {
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
      // Warn: session may be hanging
      emitEvent(userId, {
        event_type: "HEALTH_WARNING",
        program_id: data.programId || "unknown",
        indicator: "stale_session",
        session_id: doc.id,
        lastHeartbeat: heartbeatTime?.toISOString() || null,
        ageMinutes: Math.round(ageMs / 60000),
      });

      stale.push({
        sessionId: doc.id,
        programId: data.programId || "unknown",
        lastHeartbeat: heartbeatTime?.toISOString() || "never",
        ageMinutes: Math.round(ageMs / 60000),
        action: "warned",
      });
    }
  }

  return { checked: sessionsSnap.size, stale, archived };
}
