/**
 * Cleanup expired sessions.
 * Runs every 5 minutes. Deletes sessions older than 65 minutes.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const SESSION_TIMEOUT_MS = 65 * 60 * 1000; // 60 min + 5 min grace

export const cleanupExpiredSessions = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const expiryThreshold = Date.now() - SESSION_TIMEOUT_MS;

    functions.logger.info(
      `[cleanupExpiredSessions] Cleaning sessions older than ${new Date(expiryThreshold).toISOString()}`
    );

    try {
      const usersSnapshot = await db.collection("users").listDocuments();
      let totalDeleted = 0;

      for (const userRef of usersSnapshot) {
        const expiredSnapshot = await userRef
          .collection("sessions")
          .where("lastActivity", "<", expiryThreshold)
          .get();

        if (expiredSnapshot.empty) continue;

        const batch = db.batch();
        expiredSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        totalDeleted += expiredSnapshot.size;
        functions.logger.info(
          `Deleted ${expiredSnapshot.size} expired sessions for user ${userRef.id}`
        );
      }

      functions.logger.info(`[cleanupExpiredSessions] Total deleted: ${totalDeleted}`);
      return { deleted: totalDeleted };
    } catch (error) {
      functions.logger.error("[cleanupExpiredSessions] Error:", error);
      throw error;
    }
  });
