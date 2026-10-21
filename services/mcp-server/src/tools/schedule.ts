/**
 * Schedule Domain Registry — Recurring task scheduling tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { createScheduleHandler, listSchedulesHandler, getScheduleHandler, updateScheduleHandler, deleteScheduleHandler } from "../modules/schedule.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  schedule_create: createScheduleHandler,
  schedule_list: listSchedulesHandler,
  schedule_get: getScheduleHandler,
  schedule_update: updateScheduleHandler,
  schedule_delete: deleteScheduleHandler,
};

export const definitions = [
  {
    name: "schedule_create",
    description: "Create a recurring schedule: {name, target, cron, taskTemplate, budgetCap, enabled}. kind \"watch\" (with `watch` instead of taskTemplate) creates no task: when it fires it alerts the user (push + Slack) if the tasks schedule watch.scheduleId made in the last watch.withinHours are all still in watch.status, or if there are none.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", maxLength: 200, description: "Schedule name (e.g., 'Weekly SARK security review')" },
        target: { type: "string", maxLength: 100, description: "Target program ID" },
        cron: { type: "string", maxLength: 100, description: "Cron expression (e.g., '0 9 * * 1' for Mondays 9am)" },
        taskTemplate: {
          type: "object",
          description: "Template for the task to create on each run",
          properties: {
            title: { type: "string", maxLength: 200 },
            instructions: { type: "string", maxLength: 4000, description: "Full task instructions" },
            priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
            action: { type: "string", enum: ["queue", "interrupt"], default: "queue" },
          },
          required: ["title"],
        },
        kind: { type: "string", enum: ["task", "watch"], default: "task", description: "task (default): create a task each run. watch: alert instead; requires `watch`, omit taskTemplate" },
        watch: {
          type: "object",
          description: "kind \"watch\" only: what to watch and what to say",
          properties: {
            scheduleId: { type: "string", maxLength: 100, description: "The schedule whose tasks are watched" },
            status: { type: "string", maxLength: 50, description: "Alert while every watched task is still in this status (e.g. 'created')" },
            withinHours: { type: "number", exclusiveMinimum: 0, maximum: 168, description: "Look at tasks created within this many hours" },
            message: { type: "string", maxLength: 1500, description: "Alert text" },
          },
          required: ["scheduleId", "status", "withinHours", "message"],
        },
        budgetCap: { type: "number", minimum: 0, description: "Max $ per execution" },
        enabled: { type: "boolean", default: true },
      },
      required: ["name", "target", "cron"],
    },
  },
  {
    name: "schedule_list",
    description: "List all schedules (filterable by target program, enabled status)",
    inputSchema: {
      type: "object" as const,
      properties: {
        target: { type: "string", maxLength: 100, description: "Filter by target program ID" },
        enabled: { type: "boolean", description: "Filter by enabled status" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "schedule_get",
    description: "Get schedule by ID with next/last run times",
    inputSchema: {
      type: "object" as const,
      properties: {
        scheduleId: { type: "string", description: "The schedule ID to retrieve" },
      },
      required: ["scheduleId"],
    },
  },
  {
    name: "schedule_update",
    description: "Update cron, budget cap, enable/disable a schedule",
    inputSchema: {
      type: "object" as const,
      properties: {
        scheduleId: { type: "string", description: "The schedule ID to update" },
        cron: { type: "string", maxLength: 100, description: "New cron expression" },
        budgetCap: { type: "number", minimum: 0, nullable: true, description: "Max $ per execution (null to remove)" },
        enabled: { type: "boolean", description: "Enable or disable the schedule" },
        name: { type: "string", maxLength: 200, description: "New schedule name" },
        target: { type: "string", maxLength: 100, description: "New target program ID" },
        taskTemplate: {
          type: "object",
          description: "Updated task template",
          properties: {
            title: { type: "string", maxLength: 200 },
            instructions: { type: "string", maxLength: 4000 },
            priority: { type: "string", enum: ["low", "normal", "high"] },
            action: { type: "string", enum: ["queue", "interrupt"] },
          },
          required: ["title"],
        },
        watch: {
          type: "object",
          description: "kind \"watch\" only: what to watch and what to say",
          properties: {
            scheduleId: { type: "string", maxLength: 100, description: "The schedule whose tasks are watched" },
            status: { type: "string", maxLength: 50, description: "Alert while every watched task is still in this status (e.g. 'created')" },
            withinHours: { type: "number", exclusiveMinimum: 0, maximum: 168, description: "Look at tasks created within this many hours" },
            message: { type: "string", maxLength: 1500, description: "Alert text" },
          },
          required: ["scheduleId", "status", "withinHours", "message"],
        },
      },
      required: ["scheduleId"],
    },
  },
  {
    name: "schedule_delete",
    description: "Remove a schedule",
    inputSchema: {
      type: "object" as const,
      properties: {
        scheduleId: { type: "string", description: "The schedule ID to delete" },
      },
      required: ["scheduleId"],
    },
  },
];
