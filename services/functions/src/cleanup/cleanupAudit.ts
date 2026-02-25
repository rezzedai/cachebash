/**
 * Cleanup old audit entries.
 * Runs daily. Archives entries older than 90 days.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const RETENTION_DAYS = 90;

export const cleanupAudit = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    functions.logger.info(
      `[cleanupAudit] Removing audit entries older than ${cutoff.toISOString()}`
    );

    try {
      const oldEntries = await db
        .collectionGroup("audit")
        .where("timestamp", "<", cutoff)
        .limit(500)
        .get();

      if (oldEntries.empty) {
        functions.logger.info("[cleanupAudit] No old audit entries found");
        return { deleted: 0 };
      }

      const batch = db.batch();
      for (const doc of oldEntries.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      functions.logger.info(`[cleanupAudit] Deleted ${oldEntries.size} old audit entries`);
      return { deleted: oldEntries.size };
    } catch (error) {
      functions.logger.error("[cleanupAudit] Error:", error);
      throw error;
    }
  });
