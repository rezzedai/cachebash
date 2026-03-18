/**
 * Metrics Module — Cost aggregation endpoints for admin.
 * Queries completed tasks and returns spend totals with optional grouping.
 */

import { z } from "zod";
import { getFirestore } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { isAdmin, hasCapability } from "../middleware/gate.js";

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
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({
      success: false,
      error: "get_comms_metrics requires metrics.read capability.",
    });
  }

  const args = CommsMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();

  const start = periodStart(args.period);

  // Query relay messages
  let relayQuery: admin.firestore.Query = db.collection(`tenants/${auth.userId}/relay`);
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
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({
      success: false,
      error: "get_cost_summary requires metrics.read capability.",
    });
  }

  const args = CostSummarySchema.parse(rawArgs || {});
  const db = getFirestore();
  const tasksRef = db.collection(`tenants/${auth.userId}/tasks`);

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
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({ success: false, error: "get_operational_metrics requires metrics.read capability." });
  }

  const args = OperationalMetricsSchema.parse(rawArgs || {});
  const db = getFirestore();
  const start = periodStart(args.period);

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/events`);
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

  // STORY 1 ENHANCEMENTS: Query completed tasks for deep analysis
  let tasksQuery: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`).where("status", "==", "done");
  if (start) {
    tasksQuery = tasksQuery.where("completedAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }
  const tasksSnapshot = await tasksQuery.get();

  // Success rate by program
  const programHealthScores: Record<string, { successRate: number; totalTasks: number; failed: number; avgDurationMinutes: number | null }> = {};
  const programTaskDurations: Record<string, number[]> = {};

  // Error breakdown by class
  const errorBreakdown: Record<string, number> = {
    TRANSIENT: 0,
    PERMANENT: 0,
    DEPENDENCY: 0,
    POLICY: 0,
    TIMEOUT: 0,
    UNKNOWN: 0,
  };

  // Latency percentiles
  const taskDurations: number[] = [];

  // Intervention rate
  let retriedCount = 0;
  let cancelledCount = 0;

  for (const doc of tasksSnapshot.docs) {
    const task = doc.data();
    const programId = task.target || task.source || "unknown";

    // Success rate tracking
    if (!programHealthScores[programId]) {
      programHealthScores[programId] = { successRate: 0, totalTasks: 0, failed: 0, avgDurationMinutes: null };
      programTaskDurations[programId] = [];
    }
    programHealthScores[programId].totalTasks++;

    const isSuccess = task.completed_status === "SUCCESS";
    if (!isSuccess) {
      programHealthScores[programId].failed++;
    }

    // Error breakdown
    if (task.last_error_class && errorBreakdown[task.last_error_class] !== undefined) {
      errorBreakdown[task.last_error_class]++;
    }

    // Duration calculation (completedAt - startedAt, fallback to claimedAt)
    if (task.completedAt && (task.startedAt || task.claimedAt)) {
      const completedMs = task.completedAt.toMillis();
      const startMs = task.startedAt ? task.startedAt.toMillis() : (task.claimedAt ? task.claimedAt.toMillis() : 0);
      if (startMs > 0) {
        const durationSeconds = (completedMs - startMs) / 1000;
        taskDurations.push(durationSeconds);
        programTaskDurations[programId].push(durationSeconds / 60); // minutes
      }
    }

    // Intervention tracking
    if (task.retry && task.retry.retryCount > 0) {
      retriedCount++;
    }
    if (task.completed_status === "CANCELLED") {
      cancelledCount++;
    }
  }

  // Calculate success rates and avg durations per program
  for (const [programId, stats] of Object.entries(programHealthScores)) {
    const succeeded = stats.totalTasks - stats.failed;
    stats.successRate = stats.totalTasks > 0 ? round4((succeeded / stats.totalTasks) * 100) : 0;
    const durations = programTaskDurations[programId];
    stats.avgDurationMinutes = durations.length > 0 ? round4(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  }

  // Calculate latency percentiles
  const latencyPercentiles = taskDurations.length > 0 ? calculatePercentiles(taskDurations) : null;

  // Intervention rate
  const totalInterventions = retriedCount + cancelledCount;
  const interventionRate = {
    retried: retriedCount,
    cancelled: cancelledCount,
    total: totalInterventions,
    rate: tasksSnapshot.size > 0 ? round4((totalInterventions / tasksSnapshot.size) * 100) : 0,
  };

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
    // Story 1 enhancements
    programHealthScores,
    errorBreakdown,
    latencyPercentiles,
    interventionRate,
  });
}

// Helper function to calculate percentiles
function calculatePercentiles(values: number[]): { p50: number; p75: number; p95: number; p99: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return round4(sorted[Math.max(0, index)]);
  };
  return {
    p50: percentile(50),
    p75: percentile(75),
    p95: percentile(95),
    p99: percentile(99),
  };
}

// STORY 2: Cost Forecasting
const CostForecastSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
  forecastDays: z.number().min(1).max(365).default(30),
});

export async function getCostForecastHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({ success: false, error: "get_cost_forecast requires metrics.read capability." });
  }

  const args = CostForecastSchema.parse(rawArgs || {});
  const db = getFirestore();
  const start = periodStart(args.period);

  // Query completed tasks with cost data
  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`)
    .where("status", "==", "done")
    .where("cost_usd", ">", 0);

  if (start) {
    query = query.where("completedAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }

  const snapshot = await query.get();

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const programCosts: Record<string, number> = {};

  for (const doc of snapshot.docs) {
    const task = doc.data();
    const cost = task.cost_usd || 0;
    const tokensIn = task.tokens_in || 0;
    const tokensOut = task.tokens_out || 0;

    totalCost += cost;
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;

    const programId = task.target || task.source || "unknown";
    programCosts[programId] = (programCosts[programId] || 0) + cost;
  }

  // Calculate daily burn rate
  const now = new Date();
  const periodStartDate = start || new Date(0);
  const daysElapsed = Math.max(1, (now.getTime() - periodStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const dailyBurnRate = round4(totalCost / daysElapsed);

  // Project monthly cost
  const forecastedMonthlyCost = round4(dailyBurnRate * 30);

  // Top spenders
  const topSpenders = Object.entries(programCosts)
    .map(([program, cost]) => ({ program, cost: round4(cost) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);

  // Token burn rate
  const inputPerDay = Math.round(totalTokensIn / daysElapsed);
  const outputPerDay = Math.round(totalTokensOut / daysElapsed);
  const tokenBurnRate = {
    inputPerDay,
    outputPerDay,
    forecastedMonthlyInput: inputPerDay * 30,
    forecastedMonthlyOutput: outputPerDay * 30,
  };

  return jsonResult({
    success: true,
    period: args.period,
    currentSpend: round4(totalCost),
    dailyBurnRate,
    forecastedMonthlyCost,
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    topSpenders,
    tokenBurnRate,
  });
}

// STORY 3: SLA Compliance Tracking
const SlaComplianceSchema = z.object({
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

// SLA targets in minutes
const SLA_TARGETS: Record<string, number> = {
  "interrupt-high": 5,
  "interrupt-normal": 15,
  "interrupt-low": 15,
  "sprint-high": 30,
  "sprint-normal": 60,
  "sprint-low": 60,
  "parallel-high": 30,
  "parallel-normal": 60,
  "parallel-low": 60,
  "queue-high": 30,
  "queue-normal": 60,
  "queue-low": 60,
  "backlog-high": 24 * 60,
  "backlog-normal": 24 * 60,
  "backlog-low": 24 * 60,
};

export async function getSlaComplianceHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({ success: false, error: "get_sla_compliance requires metrics.read capability." });
  }

  const args = SlaComplianceSchema.parse(rawArgs || {});
  const db = getFirestore();
  const start = periodStart(args.period);

  // Query completed tasks
  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`).where("status", "==", "done");
  if (start) {
    query = query.where("completedAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }

  const snapshot = await query.get();

  let totalTasks = 0;
  let withinSla = 0;
  let breached = 0;
  const breachesByProgram: Record<string, number> = {};
  const breachesBySlaCategory: Record<string, number> = {};

  for (const doc of snapshot.docs) {
    const task = doc.data();
    totalTasks++;

    // Calculate duration (completedAt - createdAt)
    if (!task.completedAt || !task.createdAt) continue;

    const durationMinutes = (task.completedAt.toMillis() - task.createdAt.toMillis()) / (1000 * 60);

    // Determine SLA target
    const action = task.action || "queue";
    const priority = task.priority || "normal";
    const slaKey = `${action}-${priority}`;
    const slaTarget = SLA_TARGETS[slaKey] || 60; // default 60 minutes

    // Check compliance
    if (durationMinutes <= slaTarget) {
      withinSla++;
    } else {
      breached++;
      const programId = task.target || task.source || "unknown";
      breachesByProgram[programId] = (breachesByProgram[programId] || 0) + 1;
      breachesBySlaCategory[slaKey] = (breachesBySlaCategory[slaKey] || 0) + 1;
    }
  }

  const complianceRate = totalTasks > 0 ? round4((withinSla / totalTasks) * 100) : 100;

  return jsonResult({
    success: true,
    period: args.period,
    totalTasks,
    withinSla,
    breached,
    complianceRate,
    breachesByProgram,
    breachesBySlaCategory,
  });
}

// STORY 4: Program Health Scores
const ProgramHealthSchema = z.object({
  programId: z.string().max(100).optional(),
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

function calculateHealthScore(components: {
  successRate: number;
  latencyScore: number;
  errorScore: number;
  heartbeatScore: number;
  costScore: number;
}): number {
  const weighted =
    components.successRate * 0.4 +
    components.latencyScore * 0.2 +
    components.errorScore * 0.15 +
    components.heartbeatScore * 0.15 +
    components.costScore * 0.1;
  return round4(weighted);
}

function generateRecommendation(components: {
  successRate: number;
  latencyScore: number;
  errorScore: number;
  heartbeatScore: number;
  costScore: number;
  errorCounts: Record<string, number>;
  avgCostPerTask: number;
}): string {
  if (components.successRate < 50) {
    const dominantError = Object.entries(components.errorCounts)
      .sort(([, a], [, b]) => b - a)[0];
    if (dominantError && dominantError[0] === "TRANSIENT") {
      return "High TRANSIENT error rate — check for flaky dependencies or retry policies";
    }
    if (dominantError && dominantError[0] === "PERMANENT") {
      return "High PERMANENT error rate — review task logic and input validation";
    }
    return "Low success rate — investigate root causes of failures";
  }
  if (components.latencyScore < 50) {
    return "Tasks frequently miss SLA targets — consider optimizing execution time or adjusting SLA";
  }
  if (components.heartbeatScore < 50) {
    return "Stale heartbeat detected — session may be unhealthy or disconnected";
  }
  if (components.costScore < 50) {
    return "High cost per task — review model selection and token usage";
  }
  return "Program is healthy — all metrics within acceptable ranges";
}

export async function getProgramHealthHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Capability gate: metrics.read OR admin
  if (!isAdmin(auth) && !hasCapability(auth, "metrics.read")) {
    return jsonResult({ success: false, error: "get_program_health requires metrics.read capability." });
  }

  const args = ProgramHealthSchema.parse(rawArgs || {});
  const db = getFirestore();
  const start = periodStart(args.period);

  // Query completed tasks
  let tasksQuery: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`).where("status", "==", "done");
  if (start) {
    tasksQuery = tasksQuery.where("completedAt", ">=", admin.firestore.Timestamp.fromDate(start));
  }
  if (args.programId) {
    tasksQuery = tasksQuery.where("target", "==", args.programId);
  }

  const tasksSnapshot = await tasksQuery.get();

  // Group by program
  const programData: Record<string, {
    totalTasks: number;
    successCount: number;
    errorCounts: Record<string, number>;
    durations: number[];
    totalCost: number;
    slaBreaches: number;
  }> = {};

  for (const doc of tasksSnapshot.docs) {
    const task = doc.data();
    const programId = task.target || task.source || "unknown";

    if (!programData[programId]) {
      programData[programId] = {
        totalTasks: 0,
        successCount: 0,
        errorCounts: {},
        durations: [],
        totalCost: 0,
        slaBreaches: 0,
      };
    }

    const data = programData[programId];
    data.totalTasks++;

    if (task.completed_status === "SUCCESS") {
      data.successCount++;
    }

    if (task.last_error_class) {
      data.errorCounts[task.last_error_class] = (data.errorCounts[task.last_error_class] || 0) + 1;
    }

    if (task.cost_usd) {
      data.totalCost += task.cost_usd;
    }

    // Duration for latency score
    if (task.completedAt && task.createdAt) {
      const durationMinutes = (task.completedAt.toMillis() - task.createdAt.toMillis()) / (1000 * 60);
      data.durations.push(durationMinutes);

      // Check SLA
      const action = task.action || "queue";
      const priority = task.priority || "normal";
      const slaKey = `${action}-${priority}`;
      const slaTarget = SLA_TARGETS[slaKey] || 60;
      if (durationMinutes > slaTarget) {
        data.slaBreaches++;
      }
    }
  }

  // Query latest heartbeats for each program
  const results: Array<{
    programId: string;
    healthScore: number;
    components: {
      successRate: number;
      latencyScore: number;
      errorScore: number;
      heartbeatScore: number;
      costScore: number;
    };
    recommendation: string;
  }> = [];

  for (const [programId, data] of Object.entries(programData)) {
    // Success rate component (0-100)
    const successRate = data.totalTasks > 0 ? (data.successCount / data.totalTasks) * 100 : 0;

    // Latency score (0-100) — % of tasks within SLA
    const latencyScore = data.totalTasks > 0 ? ((data.totalTasks - data.slaBreaches) / data.totalTasks) * 100 : 100;

    // Error score (0-100) — fewer PERMANENT errors = better
    const permanentErrors = data.errorCounts.PERMANENT || 0;
    const errorScore = data.totalTasks > 0 ? Math.max(0, 100 - (permanentErrors / data.totalTasks) * 200) : 100;

    // Heartbeat score (0-100)
    let heartbeatScore = 50; // default neutral
    try {
      const sessionsQuery = await db.collection(`tenants/${auth.userId}/sessions`)
        .where("programId", "==", programId)
        .orderBy("lastHeartbeat", "desc")
        .limit(1)
        .get();

      if (!sessionsQuery.empty) {
        const session = sessionsQuery.docs[0].data();
        if (session.lastHeartbeat) {
          const ageMinutes = (Date.now() - session.lastHeartbeat.toMillis()) / (1000 * 60);
          if (ageMinutes < 5) heartbeatScore = 100;
          else if (ageMinutes < 15) heartbeatScore = 75;
          else if (ageMinutes < 60) heartbeatScore = 50;
          else heartbeatScore = 25;
        }
      }
    } catch (err) {
      // Heartbeat query failed, use neutral score
    }

    // Cost efficiency score (0-100) — lower cost per task = better
    const avgCostPerTask = data.totalTasks > 0 ? data.totalCost / data.totalTasks : 0;
    let costScore = 100;
    if (avgCostPerTask > 0.5) costScore = 25;
    else if (avgCostPerTask > 0.1) costScore = 50;
    else if (avgCostPerTask > 0.05) costScore = 75;

    const components = {
      successRate: round4(successRate),
      latencyScore: round4(latencyScore),
      errorScore: round4(errorScore),
      heartbeatScore: round4(heartbeatScore),
      costScore: round4(costScore),
    };

    const healthScore = calculateHealthScore(components);
    const recommendation = generateRecommendation({
      ...components,
      errorCounts: data.errorCounts,
      avgCostPerTask,
    });

    results.push({
      programId,
      healthScore,
      components,
      recommendation,
    });
  }

  // Sort by health score descending
  results.sort((a, b) => b.healthScore - a.healthScore);

  return jsonResult({
    success: true,
    period: args.period,
    programs: args.programId ? results : results,
  });
}
