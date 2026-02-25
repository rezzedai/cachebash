/**
 * Stale Session Detector — Identifies and archives sessions with no recent heartbeat.
 * Called periodically from the cleanup interval in index.ts.
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";

interface StaleSession {
  sessionId: string;
  programId: string;
  lastHeartbeat: string | null;
  ageMinutes: number;
  action: "warned" | "archived";
}

interface DetectionResult {
  stale: StaleSession[];
  archived: number;
}

const STALE_THRESHOLD_MS = 65 * 60 * 1000; // 65 minutes
const ARCHIVE_THRESHOLD_MS = 120 * 60 * 1000; // 2 hours

/**
 * Detect sessions with no heartbeat for 65+ minutes.
 * Sessions stale for 2+ hours are archived.
 */
export async function detectStaleSessions(userId: string): Promise<DetectionResult> {
  const db = getFirestore();
  const now = Date.now();
  const staleThreshold = new Date(now - STALE_THRESHOLD_MS);

  const sessionsSnap = await db.collection(`tenants/${userId}/sessions`)
    .where("archived", "==", false)
    .where("status", "in", ["active", "blocked"])
    .get();

  const stale: StaleSession[] = [];
  let archived = 0;

  for (const doc of sessionsSnap.docs) {
    const data = doc.data();

    // Skip pinned sessions
    if (data.status === "blocked" && data.name?.includes("pinned")) continue;

    const heartbeatTime = data.lastHeartbeat?.toDate?.() || data.lastUpdate?.toDate?.();
    if (!heartbeatTime || heartbeatTime < staleThreshold) {
      const staleMs = heartbeatTime ? now - heartbeatTime.getTime() : now;
      const ageMinutes = Math.round(staleMs / 60000);
      const shouldArchive = staleMs >= ARCHIVE_THRESHOLD_MS;

      if (shouldArchive) {
        await doc.ref.update({
          status: "done",
          archived: true,
          archivedReason: "stale_heartbeat",
          archivedAt: FieldValue.serverTimestamp(),
        });
        archived++;
      }

      stale.push({
        sessionId: doc.id,
        programId: data.programId || "unknown",
        lastHeartbeat: heartbeatTime?.toISOString() || null,
        ageMinutes,
        action: shouldArchive ? "archived" : "warned",
      });
    }
  }

  return { stale, archived };
}
