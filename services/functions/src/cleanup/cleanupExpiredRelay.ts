/**
 * Cleanup expired relay messages.
 * Runs every 15 minutes. Deletes PENDING relay messages past their TTL.
 * Delivered messages are kept for audit/tracking until general retention cleanup.
 * Collection group query for scalability.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const cleanupExpiredRelay = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    const fallbackCutoff = new Date(Date.now() - DEFAULT_TTL_MS);

    functions.logger.info(
      `[cleanupExpiredRelay] Cleaning pending relay messages expired before ${now.toISOString()}`
    );

    try {
      // Pending messages with explicit expiresAt that have expired
      const expiredByTTL = await db
        .collectionGroup("relay")
        .where("status", "==", "pending")
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

      // Pending messages without expiresAt, older than 24h
      const expiredByAge = await db
        .collectionGroup("relay")
        .where("status", "==", "pending")
        .where("createdAt", "<", fallbackCutoff)
        .limit(500)
        .get();

      // Also clean delivered messages older than 48h (retention)
      const deliveredCutoff = new Date(Date.now() - 2 * DEFAULT_TTL_MS);
      const staleDelivered = await db
        .collectionGroup("relay")
        .where("status", "==", "delivered")
        .where("createdAt", "<", deliveredCutoff)
        .limit(500)
        .get();

      // Deduplicate
      const toDelete = new Map<string, FirebaseFirestore.DocumentReference>();
      expiredByTTL.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
      expiredByAge.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
      staleDelivered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));

      if (toDelete.size === 0) {
        functions.logger.info("[cleanupExpiredRelay] No expired relay messages found");
        return { deleted: 0 };
      }

      const batch = db.batch();
      for (const ref of toDelete.values()) {
        batch.delete(ref);
      }
      await batch.commit();

      functions.logger.info(`[cleanupExpiredRelay] Deleted ${toDelete.size} expired relay messages`);
      return { deleted: toDelete.size };
    } catch (error) {
      functions.logger.error("[cleanupExpiredRelay] Error:", error);
      throw error;
    }
  });
