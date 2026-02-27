/**
 * Usage Module — W1.3.3, W1.3.4, W1.3.5
 * MCP tools for querying usage data and managing budgets
 */

import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// W1.3.3: get_usage
const GetUsageSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
  groupBy: z.enum(["program", "model", "type", "none"]).default("none"),
});

export async function getUsageHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetUsageSchema.parse(rawArgs || {});
  const db = getFirestore();

  const now = new Date();
  let periodType: "hour" | "day" | "month" = "month";
  let periodKey: string;

  switch (args.period) {
    case "today":
      periodType = "day";
      periodKey = now.toISOString().split("T")[0];
      break;
    case "this_week":
      periodType = "day";
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      periodKey = weekStart.toISOString().split("T")[0];
      break;
    case "this_month":
      periodType = "month";
      periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      break;
    case "all":
      periodType = "month";
      periodKey = "";
      break;
  }

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/usage_aggregates`)
    .where("periodType", "==", periodType);

  if (periodKey) {
    query = query.where("period", ">=", periodKey);
  }

  const snapshot = await query.get();

  const grouped = new Map<string, {
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
    taskCount: number;
  }>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let groupKey = "total";

    switch (args.groupBy) {
      case "program":
        groupKey = data.programId as string;
        break;
      case "model":
        groupKey = data.model as string;
        break;
      case "type":
        groupKey = data.taskType as string;
        break;
    }

    const existing = grouped.get(groupKey) || {
      totalCostUsd: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      taskCount: 0,
    };

    existing.totalCostUsd += (data.totalCostUsd as number) || 0;
    existing.totalTokensIn += (data.totalTokensIn as number) || 0;
    existing.totalTokensOut += (data.totalTokensOut as number) || 0;
    existing.taskCount += (data.taskCount as number) || 0;

    grouped.set(groupKey, existing);
  }

  const usage = Array.from(grouped.entries()).map(([key, values]) => ({
    [args.groupBy === "none" ? "period" : args.groupBy]: key,
    ...values,
  }));

  return jsonResult({
    success: true,
    period: args.period,
    groupBy: args.groupBy,
    usage,
  });
}

// W1.3.4: get_invoice
const GetInvoiceSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
});

export async function getInvoiceHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetInvoiceSchema.parse(rawArgs);
  const db = getFirestore();

  const snapshot = await db
    .collection(`tenants/${auth.userId}/usage_aggregates`)
    .where("periodType", "==", "month")
    .where("period", "==", args.month)
    .get();

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalTasks = 0;

  const byProgram = new Map<string, number>();
  const byModel = new Map<string, number>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const cost = (data.totalCostUsd as number) || 0;
    const program = data.programId as string;
    const model = data.model as string;

    totalCost += cost;
    totalTokensIn += (data.totalTokensIn as number) || 0;
    totalTokensOut += (data.totalTokensOut as number) || 0;
    totalTasks += (data.taskCount as number) || 0;

    byProgram.set(program, (byProgram.get(program) || 0) + cost);
    byModel.set(model, (byModel.get(model) || 0) + cost);
  }

  return jsonResult({
    success: true,
    month: args.month,
    totalCostUsd: totalCost,
    totalTokensIn,
    totalTokensOut,
    taskCount: totalTasks,
    byProgram: Object.fromEntries(byProgram),
    byModel: Object.fromEntries(byModel),
  });
}

// W1.3.5: set_budget
const SetBudgetSchema = z.object({
  monthlyBudgetUsd: z.number().nonnegative().nullable().optional(),
  tokenBudgetMonthly: z.number().nonnegative().nullable().optional(),
  alertThresholds: z.array(z.number().min(0).max(100)).optional(),
});

export async function setBudgetHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SetBudgetSchema.parse(rawArgs);
  const db = getFirestore();

  const updateFields: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (args.monthlyBudgetUsd !== undefined) {
    updateFields.monthlyBudgetUsd = args.monthlyBudgetUsd;
  }
  if (args.tokenBudgetMonthly !== undefined) {
    updateFields.tokenBudgetMonthly = args.tokenBudgetMonthly;
  }
  if (args.alertThresholds !== undefined) {
    updateFields.alertThresholds = args.alertThresholds;
  }

  await db.doc(`tenants/${auth.userId}/_meta/billing`).set(updateFields, { merge: true });

  return jsonResult({
    success: true,
    message: "Budget configuration updated",
    updated: updateFields,
  });
}
