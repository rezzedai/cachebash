/**
 * Kill Mechanism 3: Dream timeout enforcement.
 * Scheduled function that checks for active dreams exceeding their timeout_hours.
 * Runs every 5 minutes.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

export const enforceDreamTimeouts = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();

    functions.logger.info("[enforceDreamTimeouts] Checking active dreams for timeout violations");

    try {
      // Iterate all users — dreams are in users/{uid}/tasks
      const usersSnapshot = await db.collection("users").listDocuments();
      let timedOut = 0;

      for (const userRef of usersSnapshot) {
        const dreamsSnapshot = await userRef
          .collection("tasks")
          .where("type", "==", "dream")
          .where("status", "==", "active")
          .get();

        if (dreamsSnapshot.empty) continue;

        for (const doc of dreamsSnapshot.docs) {
          const data = doc.data();
          const startedAt = data.startedAt?.toMillis?.();
          const timeoutHours = data.dream?.timeout_hours || 4; // Default 4h

          if (!startedAt) {
            functions.logger.warn(`Dream ${doc.id} is active but has no startedAt`);
            continue;
          }

          const elapsedMs = now - startedAt;
          const timeoutMs = timeoutHours * 60 * 60 * 1000;

          if (elapsedMs >= timeoutMs) {
            const elapsedHours = (elapsedMs / (60 * 60 * 1000)).toFixed(1);
            functions.logger.warn(
              `[enforceDreamTimeouts] Dream ${doc.id} timed out: ${elapsedHours}h elapsed >= ${timeoutHours}h limit. Killing.`
            );

            await doc.ref.update({
              status: "failed",
              "dream.outcome": `Timeout: ${elapsedHours}h elapsed, ${timeoutHours}h limit`,
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            timedOut++;
          }
        }
      }

      functions.logger.info(`[enforceDreamTimeouts] Complete. ${timedOut} dream(s) timed out.`);
      return { timedOut };
    } catch (error) {
      functions.logger.error("[enforceDreamTimeouts] Error:", error);
      throw error;
    }
  });
