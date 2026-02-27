/**
 * W1.1.5: Hourly aggregation of usage_ledger to usage_aggregates
 *
 * Runs every hour and:
 * 1. Reads usage_ledger entries since last aggregation
 * 2. Computes rollups by hour/day/month, program, model, and task type
 * 3. Writes pre-computed aggregates to usage_aggregates collection
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

interface UsageLedgerEntry {
  taskId: string;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  completedAt: admin.firestore.Timestamp;
  programId: string;
  taskType: string;
  completed_status: string;
}

function getPeriodKey(date: Date, type: "hour" | "day" | "month"): string {
  const d = new Date(date);

  switch (type) {
    case "hour":
      d.setMinutes(0, 0, 0);
      return d.toISOString();
    case "day":
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split("T")[0];
    case "month":
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split("T")[0].substring(0, 7); // YYYY-MM
    default:
      return d.toISOString();
  }
}

export const aggregateUsage = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    functions.logger.info("[aggregateUsage] Starting hourly aggregation");

    try {
      // Use collection group query to aggregate across all users
      const allUsersSnapshot = await db.collection("tenants").listDocuments();

      let totalProcessed = 0;
      let totalAggregates = 0;

      for (const userRef of allUsersSnapshot) {
        const userId = userRef.id;

        // Get last aggregation timestamp for this user
        const metaDoc = await db.doc(`tenants/${userId}/usage_metadata/last_aggregation`).get();
        const lastAggregation = metaDoc.exists
          ? (metaDoc.data()?.timestamp as admin.firestore.Timestamp)?.toDate() || new Date(0)
          : new Date(0);

        // Query usage_ledger entries since last aggregation
        const ledgerSnapshot = await db
          .collection(`tenants/${userId}/usage_ledger`)
          .where("completedAt", ">", admin.firestore.Timestamp.fromDate(lastAggregation))
          .orderBy("completedAt", "asc")
          .limit(5000) // Process in batches
          .get();

        if (ledgerSnapshot.empty) {
          continue;
        }

        functions.logger.info(`[aggregateUsage] Processing ${ledgerSnapshot.size} entries for user ${userId}`);

        // Group entries by period, program, model, and task type
        const aggregates = new Map<string, {
          period: string;
          periodType: "hour" | "day" | "month";
          programId: string;
          model: string;
          taskType: string;
          totalTokensIn: number;
          totalTokensOut: number;
          totalCostUsd: number;
          taskCount: number;
          successCount: number;
          failedCount: number;
        }>();

        let latestTimestamp = lastAggregation;

        for (const doc of ledgerSnapshot.docs) {
          const entry = doc.data() as UsageLedgerEntry;
          const completedAt = entry.completedAt.toDate();

          if (completedAt > latestTimestamp) {
            latestTimestamp = completedAt;
          }

          // Create aggregates for hour, day, and month
          const periods: Array<{ type: "hour" | "day" | "month" }> = [
            { type: "hour" },
            { type: "day" },
            { type: "month" },
          ];

          for (const { type } of periods) {
            const periodKey = getPeriodKey(completedAt, type);
            const model = entry.model || "unknown";
            const taskType = entry.taskType || "unknown";
            const programId = entry.programId || "unknown";

            const key = `${type}:${periodKey}:${programId}:${model}:${taskType}`;

            const existing = aggregates.get(key);
            if (existing) {
              existing.totalTokensIn += entry.tokens_in || 0;
              existing.totalTokensOut += entry.tokens_out || 0;
              existing.totalCostUsd += entry.cost_usd || 0;
              existing.taskCount += 1;
              if (entry.completed_status === "SUCCESS") {
                existing.successCount += 1;
              } else if (entry.completed_status === "FAILED") {
                existing.failedCount += 1;
              }
            } else {
              aggregates.set(key, {
                period: periodKey,
                periodType: type,
                programId,
                model,
                taskType,
                totalTokensIn: entry.tokens_in || 0,
                totalTokensOut: entry.tokens_out || 0,
                totalCostUsd: entry.cost_usd || 0,
                taskCount: 1,
                successCount: entry.completed_status === "SUCCESS" ? 1 : 0,
                failedCount: entry.completed_status === "FAILED" ? 1 : 0,
              });
            }
          }
        }

        // Write aggregates to usage_aggregates collection (upsert with merge)
        const batch = db.batch();
        let batchCount = 0;

        for (const [key, agg] of aggregates.entries()) {
          const docId = key.replace(/:/g, "_"); // Firestore-safe ID
          const aggRef = db.doc(`tenants/${userId}/usage_aggregates/${docId}`);

          batch.set(aggRef, {
            ...agg,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          batchCount++;
          totalAggregates++;

          // Commit batch every 500 operations
          if (batchCount >= 500) {
            await batch.commit();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }

        // Update last aggregation timestamp
        await db.doc(`tenants/${userId}/usage_metadata/last_aggregation`).set({
          timestamp: admin.firestore.Timestamp.fromDate(latestTimestamp),
          lastRun: admin.firestore.FieldValue.serverTimestamp(),
          entriesProcessed: ledgerSnapshot.size,
        });

        totalProcessed += ledgerSnapshot.size;
      }

      functions.logger.info(`[aggregateUsage] Completed. Processed ${totalProcessed} entries, wrote ${totalAggregates} aggregates`);
      return { success: true, entriesProcessed: totalProcessed, aggregatesWritten: totalAggregates };
    } catch (error) {
      functions.logger.error("[aggregateUsage] Error:", error);
      throw error;
    }
  });
