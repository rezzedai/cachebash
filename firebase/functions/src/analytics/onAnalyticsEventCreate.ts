import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { buildAggregateKeys } from "./helpers";

const db = admin.firestore();

/**
 * Triggered when a new analytics event is created.
 * Aggregates counters into daily, weekly, and monthly rollups
 * using atomic increment — no read-before-write.
 */
export const onAnalyticsEventCreate = functions.firestore
  .document("users/{userId}/analytics_events/{eventId}")
  .onCreate(async (snapshot, context) => {
    const { userId } = context.params;
    const data = snapshot.data();

    const eventType: string | undefined = data.eventType;
    const programId: string | undefined = data.programId;
    const timestamp = data.timestamp;

    // Skip if missing required eventType
    if (!eventType) {
      functions.logger.warn("Analytics event missing eventType, skipping aggregation");
      return;
    }

    // Parse timestamp — handle Firestore Timestamp, ISO string, or fallback to now
    let date: Date;
    if (timestamp && typeof timestamp.toDate === "function") {
      date = timestamp.toDate();
    } else if (typeof timestamp === "string") {
      date = new Date(timestamp);
    } else {
      date = new Date();
    }

    if (isNaN(date.getTime())) {
      functions.logger.warn("Analytics event has invalid timestamp, using current time");
      date = new Date();
    }

    const keys = buildAggregateKeys(date);
    const increment = admin.firestore.FieldValue.increment(1);
    const aggregatesRef = db.collection(`users/${userId}/analytics_aggregates`);

    // Build the update payload — same shape for all three periods
    const update: Record<string, admin.firestore.FieldValue> = {
      totalEvents: increment,
      [`byType.${eventType}`]: increment,
    };

    if (programId) {
      update[`byProgram.${programId}`] = increment;
    }

    const options: admin.firestore.SetOptions = { merge: true };

    try {
      await Promise.all([
        aggregatesRef.doc(keys.daily).set(update, options),
        aggregatesRef.doc(keys.weekly).set(update, options),
        aggregatesRef.doc(keys.monthly).set(update, options),
      ]);
    } catch (error) {
      functions.logger.error("Failed to write analytics aggregates", error);
    }
  });
