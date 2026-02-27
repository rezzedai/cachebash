/**
 * Cleanup expired tasks (TTL-based auto-expiration).
 * Runs every 5 minutes. Uses collection group query for scalability.
 * Transitions expired tasks to done/CANCELLED with TIMEOUT error class.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

export const cleanupExpiredTasks = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    functions.logger.info("[cleanupExpiredTasks] Checking for expired tasks");

    try {
      // Collection group query across all users' tasks
      const expiredSnapshot = await db
        .collectionGroup("tasks")
        .where("status", "in", ["created", "active"])
        .where("expiresAt", "<=", now)
        .limit(500)
        .get();

      if (expiredSnapshot.empty) {
        functions.logger.info("[cleanupExpiredTasks] No expired tasks found");
        return { expired: 0 };
      }

      const batch = db.batch();
      const expiredIds: string[] = [];

      for (const doc of expiredSnapshot.docs) {
        batch.update(doc.ref, {
          status: "done",
          completed_status: "CANCELLED",
          error_code: "TIMEOUT",
          error_class: "TIMEOUT",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          expiry_reason: "TTL_EXPIRED",
        });
        expiredIds.push(doc.id);
      }

      await batch.commit();

      functions.logger.info(
        `[cleanupExpiredTasks] Expired ${expiredIds.length} tasks:`,
        expiredIds
      );

      return { expired: expiredIds.length };
    } catch (error) {
      functions.logger.error("[cleanupExpiredTasks] Error:", error);
      throw error;
    }
  });
