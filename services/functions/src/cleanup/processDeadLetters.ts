/**
 * Dead-letter expired relay messages.
 * Runs every 15 minutes. A pending relay message is deliverable until its
 * expiresAt (the sender's TTL, default 24h). Past that, it is marked
 * status "dead_lettered" IN PLACE, in tenants/{uid}/relay, so get_sent_messages,
 * query_message_history and get_dead_letters can still see it.
 *
 * This function used to dead-letter on AGE (pending for 1h, three runs) and
 * then copy the doc to tenants/{uid}/dead_letters and DELETE it from relay. A
 * message to a slow reader (TENSOR reads from occasional sessions) was removed
 * about 1.5-2h after sending, unread, and no tool could see it again
 * (2026-10-21, K0NF26vX). It never deletes and never copies now.
 *
 * Fields written match mcp-server's cleanupExpiredRelayMessages.
 *
 * ORDERING WITH THE OTHER REAPERS (all every 15 minutes, order unspecified):
 *   - this function is the ONLY one that acts on a pending relay doc past its
 *     TTL (reapExpiredByTTL no longer handles relay; cleanupExpiredRelay never
 *     touches a pending doc), so there is no race on the expiresAt boundary;
 *   - cleanupExpiredRelay retires a dead_lettered doc 7 days after its expiresAt.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const BATCH_LIMIT = 400; // Firestore batch cap is 500

export interface DeadLetterRunResult {
  deadLettered: number;
}

export async function deadLetterExpiredRelay(
  db: FirebaseFirestore.Firestore,
  now: Date = new Date()
): Promise<DeadLetterRunResult> {
  const fallbackCutoff = new Date(now.getTime() - DEFAULT_TTL_MS);

  // Pending past its explicit expiresAt.
  const expiredByTTL = await db
    .collectionGroup("relay")
    .where("status", "==", "pending")
    .where("expiresAt", "<", now)
    .limit(BATCH_LIMIT)
    .get();

  // Pending with no expiresAt at all: older than the default TTL. A doc that
  // has an expiresAt in the future is NOT expired, however old it is.
  const expiredByAge = await db
    .collectionGroup("relay")
    .where("status", "==", "pending")
    .where("createdAt", "<", fallbackCutoff)
    .limit(BATCH_LIMIT)
    .get();

  const targets = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  expiredByTTL.docs.forEach((doc) => targets.set(doc.ref.path, doc));
  expiredByAge.docs.forEach((doc) => {
    if (doc.data().expiresAt == null) targets.set(doc.ref.path, doc);
  });

  if (targets.size === 0) return { deadLettered: 0 };

  const batch = db.batch();
  for (const doc of targets.values()) {
    const data = doc.data();
    const attempts = data.deliveryAttempts || 0;
    const maxAttempts = data.maxDeliveryAttempts || MAX_DELIVERY_ATTEMPTS;
    batch.update(doc.ref, {
      status: "dead_lettered",
      reason: "TTL expired",
      dead_letter_reason: "EXPIRED_TTL",
      dead_letter_class: attempts >= maxAttempts ? "MAX_ATTEMPTS_EXCEEDED" : "EXPIRED_TTL",
      deadLetteredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { deadLettered: targets.size };
}

export const processDeadLetters = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    try {
      const result = await deadLetterExpiredRelay(admin.firestore());
      functions.logger.info(`[processDeadLetters] Dead-lettered ${result.deadLettered} expired pending messages in place`);
      return result;
    } catch (error) {
      functions.logger.error("[processDeadLetters] Error:", error);
      throw error;
    }
  });
