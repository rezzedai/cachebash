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

export async function listSchedulesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ListSchedulesSchema.parse(rawArgs);
  const db = getFirestore();

  let ref: FirebaseFirestore.Query = db.collection(`tenants/${auth.userId}/schedules`);

  if (args.target) {
    ref = ref.where("target", "==", args.target);
  }
  if (args.enabled !== undefined) {
    ref = ref.where("enabled", "==", args.enabled);
  }

  ref = ref.orderBy("createdAt", "desc").limit(args.limit);
  const snap = await ref.get();

  const schedules = snap.docs.map(doc => doc.data());

  return jsonResult({
    success: true,
    schedules,
    total: schedules.length,
    filters: { target: args.target || null, enabled: args.enabled ?? null },
  });
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
