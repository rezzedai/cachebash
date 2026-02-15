/**
 * Cleanup expired relay messages.
 * Runs every hour. Uses expiresAt field when available, falls back to 24h TTL.
 * Collection group query for scalability.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const cleanupExpiredRelay = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    const fallbackCutoff = new Date(Date.now() - DEFAULT_TTL_MS);

    functions.logger.info(
      `[cleanupExpiredRelay] Cleaning relay messages expired before ${now.toISOString()}`
    );

    try {
      // First pass: messages with explicit expiresAt
      const expiredByTTL = await db
        .collectionGroup("relay")
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

      // Second pass: messages without expiresAt, older than 24h
      const expiredByAge = await db
        .collectionGroup("relay")
        .where("createdAt", "<", fallbackCutoff)
        .limit(500)
        .get();

      // Deduplicate
      const toDelete = new Map<string, FirebaseFirestore.DocumentReference>();
      expiredByTTL.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
      expiredByAge.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));

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
