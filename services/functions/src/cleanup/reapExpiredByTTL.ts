/**
 * TTL Reaper — Auto-expire tasks, relay messages, and proposals past their TTL.
 * Runs every 15 minutes.
 *
 * Tasks: Set status=done, completed_status=CANCELLED, result="TTL expired"
 * Relay: Set status=expired, add expiredAt timestamp
 * Proposals: Set status=expired (frees proposer quota, preserves audit trail)
 *
 * Collection group queries for scalability.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const reapExpiredByTTL = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    functions.logger.info(
      `[reapExpiredByTTL] Reaping expired tasks, relay messages, and proposals (expiresAt < ${now.toDate().toISOString()})`
    );

    try {
      // Query expired tasks (status NOT done, expiresAt < now)
      const expiredTasks = await db
        .collectionGroup("tasks")
        .where("expiresAt", "<", now)
        .where("status", "!=", "done")
        .limit(500)
        .get();

      // Query expired relay messages (status NOT done/expired, expiresAt < now)
      const expiredRelay = await db
        .collectionGroup("relay")
        .where("expiresAt", "<", now)
        .where("status", "==", "pending")
        .limit(500)
        .get();

      // Query expired proposals (status=pending, expiresAt < now)
      // Path: tenants/{userId}/gsp/_proposals/{proposalId}
      const expiredProposals = await db
        .collectionGroup("_proposals")
        .where("expiresAt", "<", now)
        .where("status", "==", "pending")
        .limit(500)
        .get();

      const totalExpired = expiredTasks.size + expiredRelay.size + expiredProposals.size;

      if (totalExpired === 0) {
        functions.logger.info("[reapExpiredByTTL] No expired items found");
        return { tasksReaped: 0, relayReaped: 0, proposalsReaped: 0 };
      }

      // Process tasks in batches (max 500 per batch)
      let tasksReaped = 0;
      if (!expiredTasks.empty) {
        const taskBatch = db.batch();
        for (const doc of expiredTasks.docs) {
          taskBatch.update(doc.ref, {
            status: "done",
            completed_status: "CANCELLED",
            result: "TTL expired",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          tasksReaped++;
        }
        await taskBatch.commit();
      }

      // Process relay messages in batches (max 500 per batch)
      let relayReaped = 0;
      if (!expiredRelay.empty) {
        const relayBatch = db.batch();
        for (const doc of expiredRelay.docs) {
          relayBatch.update(doc.ref, {
            status: "expired",
            expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          relayReaped++;
        }
        await relayBatch.commit();
      }

      // Process proposals in batches (max 500 per batch)
      let proposalsReaped = 0;
      if (!expiredProposals.empty) {
        const proposalBatch = db.batch();
        for (const doc of expiredProposals.docs) {
          const data = doc.data();
          proposalBatch.update(doc.ref, {
            status: "expired",
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            version: (data.version || 1) + 1,
          });
          proposalsReaped++;
        }
        await proposalBatch.commit();
      }

      functions.logger.info(
        `[reapExpiredByTTL] Reaped ${tasksReaped} task(s), ${relayReaped} relay message(s), and ${proposalsReaped} proposal(s)`
      );

      return { tasksReaped, relayReaped, proposalsReaped };
    } catch (error) {
      functions.logger.error("[reapExpiredByTTL] Error:", error);
      throw error;
    }
  });
