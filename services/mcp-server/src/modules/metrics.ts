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
  // R-metrics-1 (RULED, dispatch_01a061b1): event_type is only a coarse routing
  // hint -- TASK_SUCCEEDED fires for every non-FAILED completion regardless of
  // completed_status (see completion.ts:683/892). completed_status is the
  // authoritative discriminator (completion.ts:894-897) and must be read here,
  // or a SKIPPED/CANCELLED/PARTIAL close silently scores as a success.
  let taskCreated = 0, taskClaimed = 0, taskSucceeded = 0, taskFailed = 0;
  let taskSkipped = 0, taskCancelled = 0, taskPartial = 0, taskExpiredIncomplete = 0;
  let taskUnclaimed = 0;
  let workTasks = 0, controlTasks = 0;
  let guardianAllow = 0, guardianBlock = 0;
  let deadLetterCount = 0;
  let totalQueueLatencyMs = 0, totalRunLatencyMs = 0;
  let latencySamples = 0;
  let unclassified = 0;
  // R-metrics-2: a flat `unclassified` total hides WHICH event_type is
  // falling through the switch -- it reads ~14.7% "unclassified" today
  // purely from event types this handler deliberately doesn't classify
  // (RELAY_DELIVERED, SESSION_*, PROGRAM_*, BUDGET_*, GITHUB_SYNC_*, ...).
  // A genuinely new/buggy TASK_* event type would be one more count in that
  // same noisy bucket and invisible. Break it down by the raw event_type
  // string so a brand-new type shows up as its own key. The inner
  // TASK_SUCCEEDED/unrecognized-completed_status case is a DIFFERENT kind of
  // gap (unrecognized status, not unrecognized event_type) and gets its own
  // "TASK_SUCCEEDED:<status>" key so it can never collide with a real
  // event_type key.
  const unclassifiedByType: Record<string, number> = {};
  const reasonClassCounts: Record<string, number> = {};
  const deadLetterReasons: Record<string, number> = {};
  const errorClassCounts: Record<string, number> = {};
  const programCounts: Record<
    string,
    { created: number; succeeded: number; failed: number; skipped: number; cancelled: number; partial: number }
  > = {};
  // ITEM B (dispatch_01a061d9): this block builds `perProgram`, keyed on
  // data.program_id from the events stream (tenants/{uid}/events). program_id
  // here is auth.programId at emitEvent time in complete_task/
  // batch_complete_tasks/abort_task (dispatch/completion.ts,
  // dispatch/interventions.ts) -- i.e. WHO CALLED the completing tool, the
  // COMPLETER. The `programHealthScores` block below (STORY 1 ENHANCEMENTS)
  // runs a SEPARATE query over the tasks collection (tenants/{uid}/tasks,
  // status=="done") and keys on `task.target || task.source` -- the
  // ASSIGNEE. Both are legitimate but they answer different questions: this
  // block is "what happened in this window" (an append-only event log),
  // programHealthScores is "what is the state of tasks that finished in this
  // window" (a snapshot of task docs). A task whose assignee differs from
  // its completer -- e.g. the dispatcher SKIP-closing a [RECYCLE] task
  // targeted at iso -- shows up under a different key in each block. That is
  // intentional, not a bug: do NOT unify the two keys.
  //
  // ITEM C (dispatch_01a061d9): entries used to be created ONLY in the
  // TASK_CREATED case below, with every other case guarded by
  // `&& programCounts[data.program_id]`. A program that completes work in
  // this window but created nothing in it (e.g. basher, which only ever
  // completes tasks iso creates) got no entry at all and its completions
  // were silently dropped. ensureProgramCounts lazily creates the entry the
  // first time ANY event mentions a program_id, regardless of event_type --
  // `created` still means "created in this window", so a program with
  // completions and zero creations now shows created:0 instead of vanishing.
  function ensureProgramCounts(programId: string) {
    if (!programCounts[programId]) {
      programCounts[programId] = { created: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0, partial: 0 };
    }
    return programCounts[programId];
  }

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
          ensureProgramCounts(data.program_id).created++;
        }
        break;
      case "TASK_CLAIMED":
        taskClaimed++;
        break;
      case "TASK_SUCCEEDED": {
        // completed_status predates this discrimination for some historical
        // events; an absent field means SUCCESS (it was the only outcome
        // TASK_SUCCEEDED could ever carry before SKIPPED/CANCELLED/PARTIAL
        // existed), not unclassified -- do not shift historical counts.
        const status = data.completed_status;
        if (status === undefined || status === "SUCCESS") {
          taskSucceeded++;
          if (data.program_id) ensureProgramCounts(data.program_id).succeeded++;
        } else if (status === "SKIPPED") {
          taskSkipped++;
          if (data.program_id) ensureProgramCounts(data.program_id).skipped++;
        } else if (status === "CANCELLED") {
          taskCancelled++;
          if (data.program_id) ensureProgramCounts(data.program_id).cancelled++;
        } else if (status === "PARTIAL") {
          taskPartial++;
          if (data.program_id) ensureProgramCounts(data.program_id).partial++;
        } else {
          unclassified++;
          const statusKey = `TASK_SUCCEEDED:${status === null ? "(null)" : String(status)}`;
          unclassifiedByType[statusKey] = (unclassifiedByType[statusKey] || 0) + 1;
        }
        // Latency if available
        if (data.queue_latency_ms) { totalQueueLatencyMs += data.queue_latency_ms; latencySamples++; }
        if (data.run_latency_ms) { totalRunLatencyMs += data.run_latency_ms; }
        break;
      }
      case "TASK_FAILED":
        taskFailed++;
        if (data.program_id) ensureProgramCounts(data.program_id).failed++;
        if (data.error_class) errorClassCounts[data.error_class] = (errorClassCounts[data.error_class] || 0) + 1;
        break;
      case "TASK_EXPIRED_INCOMPLETE":
        // Reaped before ever completing -- not a success, and must not go
        // invisible the way it did before this fix (#425 added the emit,
        // nothing here read it).
        taskExpiredIncomplete++;
        break;
      case "TASK_ABORTED":
        // ITEM D (dispatch_01a061d9): abort_task (dispatch/interventions.ts)
        // writes status:"done", completed_status:"CANCELLED" directly on the
        // task doc -- a genuine terminal completion -- but emits its own
        // event_type instead of TASK_SUCCEEDED. Treat it as the CANCELLED
        // completion it actually is (same tallies as the CANCELLED branch
        // above) rather than letting a real completion fall into
        // unclassifiedEventTypes. This also means it now correctly feeds the
        // firstPassRate denominator via nonSuccessOutcomes below.
        taskCancelled++;
        if (data.program_id) ensureProgramCounts(data.program_id).cancelled++;
        break;
      case "TASK_UNCLAIMED":
        // ITEM D (dispatch_01a061d9): unclaim_task (dispatch/claims.ts)
        // returns the task to status:"created" -- it is NOT a completion,
        // the task is still live and can be claimed and completed again. It
        // does not belong in taskSucceeded/Failed/Skipped/Cancelled/Partial
        // or in firstPassRate's denominator, and it deliberately does NOT
        // touch programCounts (perProgram tracks completion outcomes, and an
        // unclaim is the absence of one). But it is a real, meaningful
        // operational signal -- claims.ts flags a task after 3+ unclaims for
        // manual review -- so it gets its own dedicated tally instead of
        // being invisible inside unclassifiedEventTypes.
        taskUnclaimed++;
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
      default:
        // R-metrics-1 structural fix: the next event_type added to the union
        // (like TASK_EXPIRED_INCOMPLETE was in #425) lands here instead of
        // going invisible. A wrong number gets questioned; a missing one
        // looks like health -- this tally is what keeps it from looking like
        // health.
        unclassified++;
        {
          const typeKey = eventType === undefined ? "(missing)" : String(eventType);
          unclassifiedByType[typeKey] = (unclassifiedByType[typeKey] || 0) + 1;
        }
        break;
    }
  }

  // firstPassRate denominator (RULED): SKIPPED/CANCELLED/PARTIAL and
  // TASK_EXPIRED_INCOMPLETE all consumed a dispatch without producing the
  // work, same as a FAILED -- they belong in the denominator, not just
  // "visible somewhere". Numerator stays true successes only.
  const nonSuccessOutcomes = taskFailed + taskSkipped + taskCancelled + taskPartial + taskExpiredIncomplete;
  const firstPassRate = taskCreated > 0 ? round4((taskSucceeded / Math.max(taskSucceeded + nonSuccessOutcomes, 1)) * 100) : null;
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
  // ITEM B (dispatch_01a061d9): this block re-queries tenants/{uid}/tasks
  // (status=="done") directly and keys on `task.target || task.source` --
  // the ASSIGNEE. The `perProgram`/programCounts block above (built from the
  // events stream, ~:261) keys on the completing event's program_id -- the
  // COMPLETER. See the comment on programCounts above for the full
  // rationale; the short version: this block answers "what is the state of
  // tasks that finished in this window", perProgram answers "what happened
  // in this window", and their keys are expected to diverge when the
  // assignee and completer differ. Do NOT unify the keys.
  const programHealthScores: Record<string, {
    successRate: number;
    totalTasks: number;
    succeeded: number;
    failed: number;
    skipped: number;
    cancelled: number;
    partial: number;
    avgDurationMinutes: number | null;
  }> = {};
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
      programHealthScores[programId] = {
        successRate: 0,
        totalTasks: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        partial: 0,
        avgDurationMinutes: null,
      };
      programTaskDurations[programId] = [];
    }
    programHealthScores[programId].totalTasks++;

    // ITEM A (dispatch_01a061d9): mirror the discrimination #427 already
    // applied to the top-level event counters above -- `failed` must mean
    // completed_status === "FAILED", not "anything that isn't SUCCESS".
    // SKIPPED/CANCELLED/PARTIAL are surfaced in their own fields instead of
    // being folded into `failed` or dropped; dropping would be worse than
    // folding. An absent completed_status predates this discrimination and
    // means SUCCESS (same historical-compat rule as the events branch
    // above), not unclassified.
    const taskStatus = task.completed_status;
    if (taskStatus === undefined || taskStatus === "SUCCESS") {
      programHealthScores[programId].succeeded++;
    } else if (taskStatus === "SKIPPED") {
      programHealthScores[programId].skipped++;
    } else if (taskStatus === "CANCELLED") {
      programHealthScores[programId].cancelled++;
    } else if (taskStatus === "PARTIAL") {
      programHealthScores[programId].partial++;
    } else {
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
    stats.successRate = stats.totalTasks > 0 ? round4((stats.succeeded / stats.totalTasks) * 100) : 0;
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
    unclassifiedEvents: unclassified,
    unclassifiedEventTypes: unclassifiedByType,
    tasks: {
      created: taskCreated,
      claimed: taskClaimed,
      succeeded: taskSucceeded,
      failed: taskFailed,
      skipped: taskSkipped,
      cancelled: taskCancelled,
      partial: taskPartial,
      expiredIncomplete: taskExpiredIncomplete,
      unclaimed: taskUnclaimed,
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
