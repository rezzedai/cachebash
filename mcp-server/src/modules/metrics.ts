/**
 * Metrics Module — Cost aggregation endpoints for admin.
 * Queries completed tasks and returns spend totals with optional grouping.
 */

import { z } from "zod";
import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const CostSummarySchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
  groupBy: z.enum(["program", "type", "none"]).default("none"),
  programFilter: z.string().optional(),
});

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfDay();
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfMonth(): Date {
  const d = startOfDay();
  d.setDate(1);
  return d;
}

function periodStart(period: string): Date | null {
  switch (period) {
    case "today": return startOfDay();
    case "this_week": return startOfWeek();
    case "this_month": return startOfMonth();
    case "all": return null;
    default: return startOfMonth();
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const CommsMetricsSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

export async function getCommsMetricsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin only gate
  if (!["iso", "flynn", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "get_comms_metrics is only accessible by admin.",
    });
  }

  const args = CommsMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();

  const start = periodStart(args.period);

  // Query relay messages
  let relayQuery: admin.firestore.Query = db.collection(`users/${auth.userId}/relay`);
  if (start) {
    relayQuery = relayQuery.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }
  const relaySnap = await relayQuery.get();

  // Dead letters are now relay docs with status: "dead_lettered" — counted in relay loop below
  // Aggregate by status
  const statusCounts: Record<string, number> = { delivered: 0, pending: 0, expired: 0, dead_lettered: 0 };
  let totalLatencyMs = 0;
  let deliveredCount = 0;

  // Per-program breakdown
  const programBreakdown = new Map<string, { sent: number; delivered: number }>();

  for (const doc of relaySnap.docs) {
    const data = doc.data();
    const status = data.status || "pending";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const source = data.source || "unknown";
    const prog = programBreakdown.get(source) || { sent: 0, delivered: 0 };
    prog.sent++;
    if (status === "delivered") {
      prog.delivered++;
      deliveredCount++;
      if (data.deliveredAt && data.createdAt) {
        const created = data.createdAt.toDate?.() ? data.createdAt.toDate().getTime() : 0;
        const delivered = data.deliveredAt.toDate?.() ? data.deliveredAt.toDate().getTime() : 0;
        if (created && delivered) {
          totalLatencyMs += delivered - created;
        }
      }
    }
    programBreakdown.set(source, prog);
  }


  const avgDeliveryLatencyMs = deliveredCount > 0 ? Math.round(totalLatencyMs / deliveredCount) : null;

  const perProgram = Array.from(programBreakdown.entries())
    .map(([program, stats]) => ({ program, ...stats }))
    .sort((a, b) => b.sent - a.sent);

  return jsonResult({
    success: true,
    period: args.period,
    totalMessages: relaySnap.size,
    statusCounts,
    avgDeliveryLatencyMs,
    perProgram,
  });
}

export async function getCostSummaryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CostSummarySchema.parse(rawArgs || {});
  const db = getFirestore();
  const tasksRef = db.collection(`users/${auth.userId}/tasks`);

  // Build query: status == "done", optionally filtered by completedAt and source
  let query: admin.firestore.Query = tasksRef.where("status", "==", "done");

  const start = periodStart(args.period);
  if (start) {
    query = query.where("completedAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }

  if (args.programFilter) {
    query = query.where("source", "==", args.programFilter);
  }

  const snap = await query.get();

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCostUsd = 0;
  let taskCount = 0;
  const groups = new Map<string, { tokens_in: number; tokens_out: number; cost_usd: number; task_count: number }>();

  for (const doc of snap.docs) {
    const data = doc.data();
    const tokensIn = data.tokens_in || 0;
    const tokensOut = data.tokens_out || 0;
    const costUsd = data.cost_usd || 0;

    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;
    totalCostUsd += costUsd;
    taskCount++;

    if (args.groupBy !== "none") {
      const key = args.groupBy === "program"
        ? (data.source || "unknown")
        : (data.type || "unknown");

      const group = groups.get(key) || { tokens_in: 0, tokens_out: 0, cost_usd: 0, task_count: 0 };
      group.tokens_in += tokensIn;
      group.tokens_out += tokensOut;
      group.cost_usd += costUsd;
      group.task_count++;
      groups.set(key, group);
    }
  }

  const breakdown = args.groupBy !== "none"
    ? Array.from(groups.entries())
        .map(([key, g]) => ({
          key,
          tokens_in: g.tokens_in,
          tokens_out: g.tokens_out,
          cost_usd: round4(g.cost_usd),
          task_count: g.task_count,
        }))
        .sort((a, b) => b.cost_usd - a.cost_usd)
    : [];

  return jsonResult({
    success: true,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    total_cost_usd: round4(totalCostUsd),
    task_count: taskCount,
    period: args.period,
    groupBy: args.groupBy,
    programFilter: args.programFilter || null,
    breakdown,
  });
}

const OperationalMetricsSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

export async function getOperationalMetricsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin only gate
  if (!["iso", "flynn", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({ success: false, error: "get_operational_metrics is only accessible by admin." });
  }

  const args = OperationalMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();
  const start = periodStart(args.period);

  let query: admin.firestore.Query = db.collection(`users/${auth.userId}/events`);
  if (start) {
    query = query.where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start));
  }
  const snapshot = await query.get();

  // Aggregate
  let taskCreated = 0, taskClaimed = 0, taskSucceeded = 0, taskFailed = 0;
  let workTasks = 0, controlTasks = 0;
  let guardianAllow = 0, guardianBlock = 0;
  let deadLetterCount = 0;
  let totalQueueLatencyMs = 0, totalRunLatencyMs = 0;
  let latencySamples = 0;
  const reasonClassCounts: Record<string, number> = {};
  const deadLetterReasons: Record<string, number> = {};
  const errorClassCounts: Record<string, number> = {};
  const programCounts: Record<string, { created: number; succeeded: number; failed: number }> = {};

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const eventType = data.event_type;

    switch (eventType) {
      case "TASK_CREATED":
        taskCreated++;
        if (data.task_class === "WORK") workTasks++;
        if (data.task_class === "CONTROL") controlTasks++;
        // Track by program
        if (data.program_id) {
          if (!programCounts[data.program_id]) programCounts[data.program_id] = { created: 0, succeeded: 0, failed: 0 };
          programCounts[data.program_id].created++;
        }
        break;
      case "TASK_CLAIMED":
        taskClaimed++;
        break;
      case "TASK_SUCCEEDED":
        taskSucceeded++;
        if (data.program_id && programCounts[data.program_id]) programCounts[data.program_id].succeeded++;
        // Latency if available
        if (data.queue_latency_ms) { totalQueueLatencyMs += data.queue_latency_ms; latencySamples++; }
        if (data.run_latency_ms) { totalRunLatencyMs += data.run_latency_ms; }
        break;
      case "TASK_FAILED":
        taskFailed++;
        if (data.program_id && programCounts[data.program_id]) programCounts[data.program_id].failed++;
        if (data.error_class) errorClassCounts[data.error_class] = (errorClassCounts[data.error_class] || 0) + 1;
        break;
      case "GUARDIAN_CHECK":
        if (data.decision === "ALLOW") guardianAllow++;
        if (data.decision === "BLOCK") guardianBlock++;
        if (data.reason_class && data.reason_class !== "NONE") {
          reasonClassCounts[data.reason_class] = (reasonClassCounts[data.reason_class] || 0) + 1;
        }
        break;
      case "RELAY_DEAD_LETTERED":
        deadLetterCount += (data.dead_letter_count || 1);
        if (data.dead_letter_reason) {
          deadLetterReasons[data.dead_letter_reason] = (deadLetterReasons[data.dead_letter_reason] || 0) + 1;
        }
        break;
    }
  }

  const firstPassRate = taskCreated > 0 ? round4((taskSucceeded / Math.max(taskSucceeded + taskFailed, 1)) * 100) : null;
  const avgQueueLatencyMs = latencySamples > 0 ? Math.round(totalQueueLatencyMs / latencySamples) : null;
  const avgRunLatencyMs = latencySamples > 0 ? Math.round(totalRunLatencyMs / latencySamples) : null;

  const perProgram = Object.entries(programCounts)
    .map(([program, counts]) => ({ program, ...counts }))
    .sort((a, b) => b.created - a.created);

  return jsonResult({
    success: true,
    period: args.period,
    totalEvents: snapshot.size,
    tasks: {
      created: taskCreated,
      claimed: taskClaimed,
      succeeded: taskSucceeded,
      failed: taskFailed,
      firstPassSuccessRate: firstPassRate,
      workTasks,
      controlTasks,
    },
    latency: {
      avgQueueLatencyMs,
      avgRunLatencyMs,
      samples: latencySamples,
    },
    safety: {
      guardianChecks: guardianAllow + guardianBlock,
      allowed: guardianAllow,
      blocked: guardianBlock,
      blockRate: (guardianAllow + guardianBlock) > 0 ? round4((guardianBlock / (guardianAllow + guardianBlock)) * 100) : null,
      reasonClassBreakdown: reasonClassCounts,
    },
    reliability: {
      errorClassBreakdown: errorClassCounts,
    },
    delivery: {
      deadLetterEvents: deadLetterCount,
      reasonBreakdown: deadLetterReasons,
    },
    perProgram,
  });
}
