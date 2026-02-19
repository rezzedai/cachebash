/**
 * Metrics Module — Cost aggregation endpoints for ISO.
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
