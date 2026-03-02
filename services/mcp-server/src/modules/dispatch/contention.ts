/**
 * Dispatch Module — Claim contention metrics.
 * Collection: tenants/{uid}/claim_events
 */

import { getFirestore } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import { type ToolResult, jsonResult } from "./shared.js";

const GetContentionMetricsSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

function claimPeriodStart(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this_week": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case "this_month": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d;
    }
    case "all":
      return null;
    default:
      return null;
  }
}

export async function getContentionMetricsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetContentionMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();

  const start = claimPeriodStart(args.period);

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/claim_events`);
  if (start) {
    query = query.where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start));
  }

  const snapshot = await query.get();

  let claimsAttempted = 0;
  let claimsWon = 0;
  let contentionEvents = 0;

  // For mean time to claim: collect taskIds from claimed events, then compute average
  const claimedTaskIds: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    claimsAttempted++;

    if (data.outcome === "claimed") {
      claimsWon++;
      if (data.taskId) claimedTaskIds.push(data.taskId as string);
    } else if (data.outcome === "contention") {
      contentionEvents++;
    }
  }

  // Compute mean time to claim: for each claimed task, find task createdAt vs claim event timestamp
  let meanTimeToClaimMs: number | null = null;
  if (claimedTaskIds.length > 0) {
    // Batch-fetch task docs to get createdAt timestamps
    const uniqueTaskIds = [...new Set(claimedTaskIds)].slice(0, 100); // cap at 100 lookups
    let totalClaimLatencyMs = 0;
    let latencySamples = 0;

    // Fetch tasks in batches of 10 (Firestore getAll limit per call is reasonable)
    const taskRefs = uniqueTaskIds.map((id) => db.doc(`tenants/${auth.userId}/tasks/${id}`));
    const taskDocs = await db.getAll(...taskRefs);

    const taskCreatedMap = new Map<string, number>();
    for (const taskDoc of taskDocs) {
      if (taskDoc.exists) {
        const data = taskDoc.data()!;
        const createdAt = data.createdAt?.toDate?.()?.getTime();
        if (createdAt) taskCreatedMap.set(taskDoc.id, createdAt);
      }
    }

    // Match claim events with their task's createdAt
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.outcome === "claimed" && data.taskId && data.timestamp) {
        const taskCreatedMs = taskCreatedMap.get(data.taskId as string);
        const claimTimestamp = data.timestamp?.toDate?.()?.getTime();
        if (taskCreatedMs && claimTimestamp && claimTimestamp > taskCreatedMs) {
          totalClaimLatencyMs += claimTimestamp - taskCreatedMs;
          latencySamples++;
        }
      }
    }

    if (latencySamples > 0) {
      meanTimeToClaimMs = Math.round(totalClaimLatencyMs / latencySamples);
    }
  }

  return jsonResult({
    success: true,
    period: args.period,
    claimsAttempted,
    claimsWon,
    contentionEvents,
    contentionRate: claimsAttempted > 0
      ? Math.round((contentionEvents / claimsAttempted) * 10000) / 100
      : 0,
    meanTimeToClaimMs,
  });
}
