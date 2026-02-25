/**
 * Cleanup orphaned tasks (active without heartbeat for 30+ minutes).
 * Runs every 5 minutes. Uses collection group query for scalability.
 * Reverts tasks back to created status.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

export const cleanupOrphanedTasks = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const staleThreshold = Date.now() - ORPHAN_THRESHOLD_MS;

    functions.logger.info(
      `[cleanupOrphanedTasks] Looking for active tasks with lastHeartbeat < ${new Date(staleThreshold).toISOString()}`
    );

    try {
      // Collection group query across all users' tasks
      const orphanedSnapshot = await db
        .collectionGroup("tasks")
        .where("status", "==", "active")
        .where("lastHeartbeat", "<", staleThreshold)
        .limit(500)
        .get();

      if (orphanedSnapshot.empty) {
        functions.logger.info("[cleanupOrphanedTasks] No orphaned tasks found");
        return { reverted: 0 };
      }

      const batch = db.batch();
      const revertedIds: string[] = [];

      for (const doc of orphanedSnapshot.docs) {
        batch.update(doc.ref, {
          status: "created",
          sessionId: null,
          startedAt: null,
          lastHeartbeat: null,
          revertedAt: admin.firestore.FieldValue.serverTimestamp(),
          revertReason: "heartbeat_timeout",
        });
        revertedIds.push(doc.id);
      }

      await batch.commit();

      functions.logger.info(
        `[cleanupOrphanedTasks] Reverted ${revertedIds.length} orphaned tasks:`,
        revertedIds
      );

      return { reverted: revertedIds.length };
    } catch (error) {
      functions.logger.error("[cleanupOrphanedTasks] Error:", error);
      throw error;
    }
  });
