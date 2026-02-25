/**
 * Process dead letter queue.
 * Runs every 15 minutes. Finds pending relay messages that have been
 * undelivered for too long, increments delivery attempts, and moves
 * them to the dead_letters collection after max attempts exceeded.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const MAX_DELIVERY_ATTEMPTS = 3;
const DEAD_LETTER_AGE_MS = 60 * 60 * 1000; // 1 hour

export const processDeadLetters = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - DEAD_LETTER_AGE_MS);

    functions.logger.info(
      `[processDeadLetters] Checking for undelivered messages older than ${cutoff.toISOString()}`
    );

    try {
      // Find pending relay messages older than 1 hour
      const pendingDocs = await db
        .collectionGroup("relay")
        .where("status", "==", "pending")
        .where("createdAt", "<", cutoff)
        .limit(500)
        .get();

      if (pendingDocs.empty) {
        functions.logger.info("[processDeadLetters] No pending messages to process");
        return { processed: 0, deadLettered: 0 };
      }

      let processed = 0;
      let deadLettered = 0;

      // Process in batches of 500 (Firestore limit)
      const batch = db.batch();

      for (const doc of pendingDocs.docs) {
        const data = doc.data();
        const attempts = (data.deliveryAttempts || 0) + 1;
        const maxAttempts = data.maxDeliveryAttempts || MAX_DELIVERY_ATTEMPTS;

        if (attempts >= maxAttempts) {
          // Move to dead letter queue
          // Extract userId from doc path: tenants/{uid}/relay/{id}
          const pathParts = doc.ref.path.split("/");
          const userId = pathParts[1];

          const deadLetterRef = db.doc(`tenants/${userId}/dead_letters/${doc.id}`);
          batch.set(deadLetterRef, {
            ...data,
            status: "dead_letter",
            deliveryAttempts: attempts,
            deadLetteredAt: admin.firestore.FieldValue.serverTimestamp(),
            originalPath: doc.ref.path,
          });

          // Delete from relay
          batch.delete(doc.ref);
          deadLettered++;
        } else {
          // Increment delivery attempts
          batch.update(doc.ref, {
            deliveryAttempts: attempts,
          });
        }

        processed++;
      }

      await batch.commit();

      functions.logger.info(
        `[processDeadLetters] Processed ${processed} messages, dead-lettered ${deadLettered}`
      );

      return { processed, deadLettered };
    } catch (error) {
      functions.logger.error("[processDeadLetters] Error:", error);
      throw error;
    }
  });
