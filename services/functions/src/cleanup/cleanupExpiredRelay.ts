/**
 * Cleanup relay messages by retention.
 * Runs every 15 minutes. Deletes:
 *   - delivered messages older than 48h;
 *   - dead_lettered messages 7 days after their expiresAt (so get_dead_letters
 *     has something to return).
 * It NEVER deletes a pending message. A pending message past its TTL is
 * marked dead_lettered, in place, by processDeadLetters, which is the only
 * function that acts on it: deleting it here would remove it before it was
 * marked and make it invisible to sent/history/dead-letter reads
 * (K0NF26vX, 2026-10-21). Collection group queries for scalability.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEAD_LETTER_RETENTION_MS = 7 * DEFAULT_TTL_MS;

export async function cleanupRelayByRetention(
  db: FirebaseFirestore.Firestore,
  now: Date = new Date()
): Promise<{ deleted: number }> {
  const deliveredCutoff = new Date(now.getTime() - 2 * DEFAULT_TTL_MS);
  const staleDelivered = await db
    .collectionGroup("relay")
    .where("status", "==", "delivered")
    .where("createdAt", "<", deliveredCutoff)
    .limit(500)
    .get();

  // Retired 7 days after expiresAt. A dead_lettered doc with no expiresAt falls
  // back to createdAt + default TTL + retention.
  const deadLetterCutoff = new Date(now.getTime() - DEAD_LETTER_RETENTION_MS);
  const staleDeadLettered = await db
    .collectionGroup("relay")
    .where("status", "==", "dead_lettered")
    .where("expiresAt", "<", deadLetterCutoff)
    .limit(500)
    .get();
  const staleDeadLetteredNoExpiry = await db
    .collectionGroup("relay")
    .where("status", "==", "dead_lettered")
    .where("createdAt", "<", new Date(deadLetterCutoff.getTime() - DEFAULT_TTL_MS))
    .limit(500)
    .get();

  const toDelete = new Map<string, FirebaseFirestore.DocumentReference>();
  staleDelivered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
  staleDeadLettered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
  staleDeadLetteredNoExpiry.docs.forEach((doc) => {
    if (doc.data().expiresAt == null) toDelete.set(doc.ref.path, doc.ref);
  });

  if (toDelete.size === 0) return { deleted: 0 };

  const batch = db.batch();
  for (const ref of toDelete.values()) {
    batch.delete(ref);
  }
  await batch.commit();
  return { deleted: toDelete.size };
}

export const cleanupExpiredRelay = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    try {
      const result = await cleanupRelayByRetention(admin.firestore());
      functions.logger.info(`[cleanupExpiredRelay] Deleted ${result.deleted} relay messages past retention`);
      return result;
    } catch (error) {
      functions.logger.error("[cleanupExpiredRelay] Error:", error);
      throw error;
    }
  });
