/**
 * Budget Module — Cost aggregation for Grid Portal.
 * Aggregates dream budget consumption and per-task costs.
 */

import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

interface PeriodSummary {
  dream_consumed_usd: number;
  dream_budget_cap_usd: number;
  dream_count: number;
  task_cost_usd: number;
  task_count: number;
}

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

function emptyPeriod(): PeriodSummary {
  return { dream_consumed_usd: 0, dream_budget_cap_usd: 0, dream_count: 0, task_cost_usd: 0, task_count: 0 };
}

export async function budgetSummaryHandler(auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  const db = getFirestore();
  const tasksRef = db.collection(`users/${auth.userId}/tasks`);

  const monthStart = admin.firestore.Timestamp.fromDate(startOfMonth());

  // Fetch dreams from this month (covers day + week + month)
  const dreamsSnap = await tasksRef
    .where("type", "==", "dream")
    .where("status", "in", ["active", "done", "failed"])
    .where("createdAt", ">=", monthStart)
    .get();

  // Fetch tasks with cost data from this month
  const tasksSnap = await tasksRef
    .where("type", "==", "task")
    .where("status", "==", "done")
    .where("completedAt", ">=", monthStart)
    .get();

  const today = startOfDay();
  const weekStart = startOfWeek();

  const periods = {
    today: emptyPeriod(),
    this_week: emptyPeriod(),
    this_month: emptyPeriod(),
  };

  for (const doc of dreamsSnap.docs) {
    const data = doc.data();
    const created = data.createdAt?.toDate?.() || new Date(0);
    const consumed = data.dream?.budget_consumed_usd || 0;
    const cap = data.dream?.budget_cap_usd || 0;

    // Month (all fetched docs are this month)
    periods.this_month.dream_consumed_usd += consumed;
    periods.this_month.dream_budget_cap_usd += cap;
    periods.this_month.dream_count++;

    if (created >= weekStart) {
      periods.this_week.dream_consumed_usd += consumed;
      periods.this_week.dream_budget_cap_usd += cap;
      periods.this_week.dream_count++;
    }
    if (created >= today) {
      periods.today.dream_consumed_usd += consumed;
      periods.today.dream_budget_cap_usd += cap;
      periods.today.dream_count++;
    }
  }

  for (const doc of tasksSnap.docs) {
    const data = doc.data();
    const completed = data.completedAt?.toDate?.() || new Date(0);
    const cost = data.cost_usd || 0;
    if (cost <= 0) continue;

    periods.this_month.task_cost_usd += cost;
    periods.this_month.task_count++;

    if (completed >= weekStart) {
      periods.this_week.task_cost_usd += cost;
      periods.this_week.task_count++;
    }
    if (completed >= today) {
      periods.today.task_cost_usd += cost;
      periods.today.task_count++;
    }
  }

  // Round all USD values to 4 decimal places
  for (const period of Object.values(periods)) {
    period.dream_consumed_usd = Math.round(period.dream_consumed_usd * 10000) / 10000;
    period.dream_budget_cap_usd = Math.round(period.dream_budget_cap_usd * 10000) / 10000;
    period.task_cost_usd = Math.round(period.task_cost_usd * 10000) / 10000;
  }

  return jsonResult({ success: true, periods });
}
