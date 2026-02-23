/**
 * Cleanup expired sessions.
 * Runs every 5 minutes. Transitions sessions without heartbeat for 65+ minutes to archived.
 * Emits relay message to the orchestrator for each reaped session.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const SESSION_TIMEOUT_MS = 65 * 60 * 1000; // 65 min

export const cleanupExpiredSessions = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const staleThreshold = admin.firestore.Timestamp.fromMillis(
      Date.now() - SESSION_TIMEOUT_MS
    );

    functions.logger.info(
      `[cleanupExpiredSessions] Looking for active/created sessions with lastHeartbeat < ${staleThreshold.toDate().toISOString()}`
    );

    try {
      // Collection group query across all users' sessions
      // Only target active and created sessions
      const expiredSnapshot = await db
        .collectionGroup("sessions")
        .where("status", "in", ["active", "created"])
        .where("lastHeartbeat", "<", staleThreshold)
        .limit(250) // Limit for batch safety (2 writes per session: update + relay)
        .get();

      if (expiredSnapshot.empty) {
        functions.logger.info("[cleanupExpiredSessions] No expired sessions found");
        return { reaped: 0 };
      }

      const batch = db.batch();
      const reapedSessions: string[] = [];
      const now = Date.now();

      for (const doc of expiredSnapshot.docs) {
        const data = doc.data();
        const sessionId = doc.id;
        const programId = data.programId || "unknown";
        const userId = doc.ref.parent.parent!.id;
        
        // Calculate time since last heartbeat
        const lastHeartbeatMs = data.lastHeartbeat?.toMillis() || 0;
        const minutesSinceHeartbeat = Math.round((now - lastHeartbeatMs) / 60000);

        // Update session to derezzed
        batch.update(doc.ref, {
          status: "archived",
          archived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
          reapReason: "heartbeat_timeout",
          lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Emit relay message to ISO
        const relayRef = db.collection("users").doc(userId).collection("relay").doc();
        batch.set(relayRef, {
          source: "system",
          target: "orchestrator",
          message_type: "STATUS",
          message: `Session ${sessionId} (${programId}) reaped — no heartbeat for ${minutesSinceHeartbeat} minutes`,
          priority: "normal",
          action: "queue",
          status: "created",
          read: false,
          ttl: 86400,
          expiresAt: new Date(now + 86400000),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        reapedSessions.push(`${sessionId} (${programId})`);
      }

      await batch.commit();

      functions.logger.info(
        `[cleanupExpiredSessions] Reaped ${reapedSessions.length} sessions:`,
        reapedSessions
      );

      return { reaped: reapedSessions.length };
    } catch (error) {
      functions.logger.error("[cleanupExpiredSessions] Error:", error);
      throw error;
    }
  });
