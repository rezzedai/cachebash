/**
 * Schedule Module — Recurring task scheduling.
 * Collection: tenants/{userId}/schedules/{scheduleId}
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const TaskTemplateSchema = z.object({
  title: z.string().max(200),
  instructions: z.string().max(4000).optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  action: z.enum(["queue", "interrupt"]).default("queue"),
});

const CreateScheduleSchema = z.object({
  name: z.string().max(200),
  target: z.string().max(100),
  cron: z.string().max(100),
  taskTemplate: TaskTemplateSchema,
  budgetCap: z.number().min(0).optional(),
  enabled: z.boolean().default(true),
});

const ListSchedulesSchema = z.object({
  target: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  limit: z.number().min(1).max(50).default(20),
});

const GetScheduleSchema = z.object({
  scheduleId: z.string(),
});

const UpdateScheduleSchema = z.object({
  scheduleId: z.string(),
  cron: z.string().max(100).optional(),
  budgetCap: z.number().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
  name: z.string().max(200).optional(),
  target: z.string().max(100).optional(),
  taskTemplate: TaskTemplateSchema.optional(),
});

const DeleteScheduleSchema = z.object({
  scheduleId: z.string(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute next run time from a cron expression.
 */
export function computeNextRun(cron: string): string | null {
  try {
    const interval = CronExpressionParser.parse(cron, { tz: "UTC" });
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

/**
 * Validate a cron expression. Returns true if valid.
 */
export function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron, { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

export async function createScheduleHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateScheduleSchema.parse(rawArgs);

  if (!isValidCron(args.cron)) {
    return jsonResult({
      success: false,
      error: "INVALID_CRON",
      message: `Invalid cron expression: "${args.cron}". Use standard 5-field cron syntax (minute hour day month weekday).`,
    });
  }

  const db = getFirestore();
  const now = new Date().toISOString();

  const scheduleRef = db.collection(`tenants/${auth.userId}/schedules`).doc();
  const schedule = {
    id: scheduleRef.id,
    name: args.name,
    target: args.target,
    cron: args.cron,
    taskTemplate: args.taskTemplate,
    budgetCap: args.budgetCap ?? null,
    enabled: args.enabled,
    lastRunAt: null,
    nextRunAt: computeNextRun(args.cron),
    createdAt: now,
    updatedAt: now,
    createdBy: auth.programId,
  };

  await scheduleRef.set(schedule);

  return jsonResult({
    success: true,
    scheduleId: scheduleRef.id,
    schedule,
    message: `Schedule "${args.name}" created for target "${args.target}" with cron "${args.cron}".`,
  });
}

// gRPC status code for a Firestore query whose backing composite index is
// missing. This is the ONLY error shape that triggers the fallback below --
// anything else must still fail unmistakably (R1). Value per
// google.rpc.Code / @grpc/grpc-js Status.FAILED_PRECONDITION.
const FAILED_PRECONDITION = 9;

// Internal batch size for the unfiltered pagination fallback. Independent of
// the public `limit` (capped at 50) -- that cap is exactly what makes
// filtering a single page silently partial, which R2 exists to prevent.
const FALLBACK_PAGE_SIZE = 300;

/**
 * On FAILED_PRECONDITION, page through the WHOLE unfiltered collection and
 * filter in memory (R2). "Filter one capped page, collections are small" was
 * the version this PDR was already corrected for once: schedule_list's public
 * limit is 50, so a single page yields a confident, correctly-shaped, and
 * silently partial result. This pages to exhaustion regardless of collection
 * size, matching ALL filters given, and returns the true matched count.
 */
async function paginateAndFilter(
  collRef: FirebaseFirestore.CollectionReference,
  args: { target?: string; enabled?: boolean }
): Promise<FirebaseFirestore.DocumentData[]> {
  const matched: FirebaseFirestore.DocumentData[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let page: FirebaseFirestore.Query = collRef.orderBy("createdAt", "desc").limit(FALLBACK_PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const pageSnap = await page.get();
    if (pageSnap.empty) break;
    for (const doc of pageSnap.docs) {
      const data = doc.data();
      if (args.target !== undefined && data.target !== args.target) continue;
      if (args.enabled !== undefined && data.enabled !== args.enabled) continue;
      matched.push(data);
    }
    if (pageSnap.docs.length < FALLBACK_PAGE_SIZE) break; // last page reached
    cursor = pageSnap.docs[pageSnap.docs.length - 1];
  }
  return matched;
}

export async function listSchedulesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ListSchedulesSchema.parse(rawArgs);
  const db = getFirestore();
  const collRef = db.collection(`tenants/${auth.userId}/schedules`);
  const filters = { target: args.target || null, enabled: args.enabled ?? null };

  let ref: FirebaseFirestore.Query = collRef;
  if (args.target) {
    ref = ref.where("target", "==", args.target);
  }
  if (args.enabled !== undefined) {
    ref = ref.where("enabled", "==", args.enabled);
  }
  ref = ref.orderBy("createdAt", "desc").limit(args.limit);

  try {
    const snap = await ref.get();
    const schedules = snap.docs.map(doc => doc.data());
    // R1/R5: succeeds unmistakably. `returned` is honest about what it counts
    // (this page), unlike the `total` it replaces, which reported page size
    // under a name that implies the whole collection.
    return jsonResult({ success: true, schedules, returned: schedules.length, degraded: false, filters });
  } catch (err: any) {
    if (err?.code !== FAILED_PRECONDITION) throw err; // R1: anything else still fails unmistakably.

    const matched = await paginateAndFilter(collRef, args);
    const schedules = matched.slice(0, args.limit);
    // R5: degraded is an explicit field, not something inferable only from
    // reading prose. `returned` means the SAME thing here as in the healthy
    // path above -- this page's size, never the true match count. matchedTotal
    // below carries that.
    return jsonResult({
      success: true,
      schedules,
      returned: schedules.length,
      degraded: true,
      degradedReason: "FAILED_PRECONDITION: missing composite index; served via paginated unfiltered fallback",
      // Pagination ran to exhaustion, so matchedTotal is the TRUE collection-wide
      // match count -- not merely this page's size, unlike the `total` field this
      // response replaces. `truncated` makes the gap between matchedTotal and
      // `returned` explicit rather than something a caller has to infer by
      // comparing the two counts themselves.
      matchedTotal: matched.length,
      truncated: schedules.length < matched.length,
      filters,
    });
  }
}

export async function getScheduleHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetScheduleSchema.parse(rawArgs);
  const db = getFirestore();

  const doc = await db.doc(`tenants/${auth.userId}/schedules/${args.scheduleId}`).get();

  if (!doc.exists) {
    return jsonResult({
      success: false,
      error: "SCHEDULE_NOT_FOUND",
      message: `Schedule "${args.scheduleId}" not found.`,
    });
  }

  return jsonResult({
    success: true,
    schedule: doc.data(),
  });
}

export async function updateScheduleHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateScheduleSchema.parse(rawArgs);
  const db = getFirestore();
  const now = new Date().toISOString();

  const docRef = db.doc(`tenants/${auth.userId}/schedules/${args.scheduleId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: false,
      error: "SCHEDULE_NOT_FOUND",
      message: `Schedule "${args.scheduleId}" not found.`,
    });
  }

  const updates: Record<string, unknown> = { updatedAt: now };
  if (args.cron !== undefined) {
    if (!isValidCron(args.cron)) {
      return jsonResult({
        success: false,
        error: "INVALID_CRON",
        message: `Invalid cron expression: "${args.cron}". Use standard 5-field cron syntax (minute hour day month weekday).`,
      });
    }
    updates.cron = args.cron;
    updates.nextRunAt = computeNextRun(args.cron);
  }
  if (args.budgetCap !== undefined) updates.budgetCap = args.budgetCap;
  if (args.enabled !== undefined) updates.enabled = args.enabled;
  if (args.name !== undefined) updates.name = args.name;
  if (args.target !== undefined) updates.target = args.target;
  if (args.taskTemplate !== undefined) updates.taskTemplate = args.taskTemplate;

  await docRef.update(updates);

  const updated = await docRef.get();

  return jsonResult({
    success: true,
    scheduleId: args.scheduleId,
    schedule: updated.data(),
    message: `Schedule "${args.scheduleId}" updated.`,
  });
}

export async function deleteScheduleHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = DeleteScheduleSchema.parse(rawArgs);
  const db = getFirestore();

  const docRef = db.doc(`tenants/${auth.userId}/schedules/${args.scheduleId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: false,
      error: "SCHEDULE_NOT_FOUND",
      message: `Schedule "${args.scheduleId}" not found.`,
    });
  }

  await docRef.delete();

  return jsonResult({
    success: true,
    scheduleId: args.scheduleId,
    message: `Schedule "${args.scheduleId}" deleted.`,
  });
}
