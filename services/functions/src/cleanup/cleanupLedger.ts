/**
 * Cleanup old ledger entries.
 * Runs daily. Deletes entries older than 30 days.
 * Collection group query for scalability.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const RETENTION_DAYS = 30;

export const cleanupLedger = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    functions.logger.info(
      `[cleanupLedger] Deleting ledger entries older than ${cutoff.toISOString()}`
    );

    try {
      const oldEntries = await db
        .collectionGroup("ledger")
        .where("timestamp", "<", cutoff)
        .limit(500)
        .get();

      if (oldEntries.empty) {
        functions.logger.info("[cleanupLedger] No old ledger entries found");
        return { deleted: 0 };
      }

      const batch = db.batch();
      for (const doc of oldEntries.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      functions.logger.info(`[cleanupLedger] Deleted ${oldEntries.size} old ledger entries`);
      return { deleted: oldEntries.size };
    } catch (error) {
      functions.logger.error("[cleanupLedger] Error:", error);
      throw error;
    }
  });
