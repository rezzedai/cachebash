/**
 * Fleet Timeline Module — Historical fleet snapshot queries.
 * Collection: tenants/{uid}/fleet_snapshots
 *
 * Provides time-series fleet health data with configurable resolution.
 * Snapshots are written by the Dispatcher (Wave 2); this module handles reads only.
 */

import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const GetFleetTimelineSchema = z.object({
  period: z.enum(["today", "this_week", "this_month"]).default("today"),
  resolution: z.enum(["30s", "1m", "5m", "1h"]).default("5m"),
});

/**
 * Compute the start timestamp for a given period.
 */
function periodStart(period: string): Date {
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
    default:
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

/**
 * Convert resolution string to milliseconds.
 */
function resolutionMs(resolution: string): number {
  switch (resolution) {
    case "30s": return 30 * 1000;
    case "1m":  return 60 * 1000;
    case "5m":  return 5 * 60 * 1000;
    case "1h":  return 60 * 60 * 1000;
    default:    return 5 * 60 * 1000;
  }
}

/**
 * Fleet snapshot document schema (as stored in Firestore).
 */
interface FleetSnapshot {
  timestamp: admin.firestore.Timestamp;
  activeSessions: {
    total: number;
    byTier: Record<string, number>;
    byProgram: Record<string, number>;
  };
  tasksInFlight: number;
  messagesPending: number;
  heartbeatHealth: number;
  ttl?: admin.firestore.Timestamp;
}

/**
 * Aggregate snapshots into resolution buckets by averaging numeric fields.
 */
function aggregateSnapshots(
  snapshots: Array<{ timestamp: Date; data: FleetSnapshot }>,
  resMs: number,
): Array<Record<string, unknown>> {
  if (snapshots.length === 0) return [];

  // Group snapshots into time buckets
  const buckets = new Map<number, Array<{ timestamp: Date; data: FleetSnapshot }>>();

  for (const snap of snapshots) {
    const bucketKey = Math.floor(snap.timestamp.getTime() / resMs) * resMs;
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(snap);
    } else {
      buckets.set(bucketKey, [snap]);
    }
  }

  // Sort bucket keys chronologically
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

  return sortedKeys.map((key) => {
    const items = buckets.get(key)!;
    const count = items.length;

    // Average numeric fields
    const avgTasksInFlight = items.reduce((s, i) => s + i.data.tasksInFlight, 0) / count;
    const avgMessagesPending = items.reduce((s, i) => s + i.data.messagesPending, 0) / count;
    const avgHeartbeatHealth = items.reduce((s, i) => s + i.data.heartbeatHealth, 0) / count;
    const avgTotalSessions = items.reduce((s, i) => s + (i.data.activeSessions?.total || 0), 0) / count;

    // Merge byTier and byProgram maps by averaging
    const byTier: Record<string, number> = {};
    const byProgram: Record<string, number> = {};

    for (const item of items) {
      if (item.data.activeSessions?.byTier) {
        for (const [tier, val] of Object.entries(item.data.activeSessions.byTier)) {
          byTier[tier] = (byTier[tier] || 0) + val;
        }
      }
      if (item.data.activeSessions?.byProgram) {
        for (const [prog, val] of Object.entries(item.data.activeSessions.byProgram)) {
          byProgram[prog] = (byProgram[prog] || 0) + val;
        }
      }
    }

    // Average the tier and program counts
    for (const tier of Object.keys(byTier)) {
      byTier[tier] = byTier[tier] / count;
    }
    for (const prog of Object.keys(byProgram)) {
      byProgram[prog] = byProgram[prog] / count;
    }

    return {
      bucketStart: new Date(key).toISOString(),
      samplesInBucket: count,
      activeSessions: {
        total: Math.round(avgTotalSessions * 100) / 100,
        byTier,
        byProgram,
      },
      tasksInFlight: Math.round(avgTasksInFlight * 100) / 100,
      messagesPending: Math.round(avgMessagesPending * 100) / 100,
      heartbeatHealth: Math.round(avgHeartbeatHealth * 1000) / 1000,
    };
  });
}

export async function getFleetTimelineHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetFleetTimelineSchema.parse(rawArgs);
  const db = getFirestore();

  const start = periodStart(args.period);
  const startTimestamp = admin.firestore.Timestamp.fromDate(start);

  const snapshot = await db
    .collection(`tenants/${auth.userId}/fleet_snapshots`)
    .where("timestamp", ">=", startTimestamp)
    .orderBy("timestamp", "asc")
    .get();

  if (snapshot.empty) {
    return jsonResult({
      success: true,
      period: args.period,
      resolution: args.resolution,
      count: 0,
      timeline: [],
      message: "No fleet snapshots found for the requested period.",
    });
  }

  // Parse raw snapshots
  const rawSnapshots = snapshot.docs.map((doc) => {
    const data = doc.data() as FleetSnapshot;
    const ts = data.timestamp as admin.firestore.Timestamp;
    return {
      timestamp: ts.toDate(),
      data,
    };
  });

  const resMs = resolutionMs(args.resolution);
  const baseResMs = 30 * 1000; // 30s is the finest resolution

  let timeline: Array<Record<string, unknown>>;

  if (resMs <= baseResMs) {
    // No aggregation needed — return raw snapshots
    timeline = rawSnapshots.map((s) => ({
      bucketStart: s.timestamp.toISOString(),
      samplesInBucket: 1,
      activeSessions: s.data.activeSessions || { total: 0, byTier: {}, byProgram: {} },
      tasksInFlight: s.data.tasksInFlight || 0,
      messagesPending: s.data.messagesPending || 0,
      heartbeatHealth: s.data.heartbeatHealth || 0,
    }));
  } else {
    // Aggregate into resolution buckets
    timeline = aggregateSnapshots(rawSnapshots, resMs);
  }

  return jsonResult({
    success: true,
    period: args.period,
    resolution: args.resolution,
    count: timeline.length,
    timeline,
    message: `Found ${timeline.length} data point(s) for period "${args.period}" at ${args.resolution} resolution.`,
  });
}
/**
 * Write a fleet health snapshot for time-series tracking.
 * Called by the Grid Dispatcher daemon every 30s.
 */
const WriteFleetSnapshotSchema = z.object({
  activeSessions: z.object({
    total: z.number(),
    byTier: z.record(z.string(), z.number()).optional().default({}),
    byProgram: z.record(z.string(), z.number()).optional().default({}),
  }),
  tasksInFlight: z.number().optional().default(0),
  messagesPending: z.number().optional().default(0),
  heartbeatHealth: z.number().optional().default(1.0),
});

export async function writeFleetSnapshotHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = WriteFleetSnapshotSchema.parse(rawArgs);
  const db = getFirestore();

  const snapshot = {
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    activeSessions: {
      total: args.activeSessions.total,
      byTier: args.activeSessions.byTier || {},
      byProgram: args.activeSessions.byProgram || {},
    },
    tasksInFlight: args.tasksInFlight,
    messagesPending: args.messagesPending,
    heartbeatHealth: args.heartbeatHealth,
    ttl: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // 7-day TTL
  };

  await db.collection(`tenants/${auth.userId}/fleet_snapshots`).add(snapshot);

  return jsonResult({
    success: true,
    message: "Fleet snapshot written",
  });
}
