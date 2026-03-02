/**
 * Pulse Domain Registry — Session tracking, fleet health, and context utilization tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { createSessionHandler, updateSessionHandler, listSessionsHandler, getFleetHealthHandler, getContextUtilizationHandler } from "../modules/pulse.js";
import { getFleetTimelineHandler, writeFleetSnapshotHandler } from "../modules/fleet-timeline.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  create_session: createSessionHandler,
  update_session: updateSessionHandler,
  list_sessions: listSessionsHandler,
  get_fleet_health: getFleetHealthHandler,
  get_fleet_timeline: getFleetTimelineHandler,
  write_fleet_snapshot: writeFleetSnapshotHandler,
  get_context_utilization: getContextUtilizationHandler,
};

export const definitions = [
  {
    name: "create_session",
    description: "Create a new session to track work progress",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", maxLength: 200 },
        sessionId: { type: "string", maxLength: 100, description: "Custom session ID (upserts if exists)" },
        programId: { type: "string", maxLength: 50 },
        status: { type: "string", maxLength: 200 },
        state: { type: "string", enum: ["working", "blocked", "complete", "pinned"], default: "working" },
        progress: { type: "number", minimum: 0, maximum: 100 },
        projectName: { type: "string", maxLength: 100 },
      },
      required: ["name"],
    },
  },
  {
    name: "update_session",
    description: "Update working status visible in the app. Also handles heartbeat (set lastHeartbeat: true). Replaces update_status and send_heartbeat.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", maxLength: 200 },
        sessionId: { type: "string" },
        state: { type: "string", enum: ["working", "blocked", "complete", "pinned"], default: "working" },
        progress: { type: "number", minimum: 0, maximum: 100 },
        projectName: { type: "string", maxLength: 100 },
        lastHeartbeat: { type: "boolean", description: "Also update heartbeat timestamp" },
        contextBytes: { type: "number", minimum: 0, description: "Current context window usage in bytes" },
        handoffRequired: { type: "boolean", description: "True when context exceeds rotation threshold" },
      },
      required: ["status"],
    },
  },
  {
    name: "list_sessions",
    description: "List active sessions for the authenticated user",
    inputSchema: {
      type: "object" as const,
      properties: {
        state: { type: "string", enum: ["working", "blocked", "pinned", "complete", "all"], default: "all" },
        programId: { type: "string", maxLength: 50 },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
        includeArchived: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "get_fleet_health",
    description: "Get health status of all programs. Shows heartbeat age, pending messages/tasks per program. Admin only. Use detail='full' for telemetry dashboard (context health, task contention, rate limits).",
    inputSchema: {
      type: "object" as const,
      properties: {
        detail: { type: "string", enum: ["summary", "full"], default: "summary", description: "Detail level: 'summary' (programs + heartbeat + subscription budget) or 'full' (adds context health, task contention, rate limits)" },
      },
    },
  },
  {
    name: "get_fleet_timeline",
    description: "Query historical fleet snapshots with configurable resolution. Returns time-series data for fleet health visualization.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month"], default: "today", description: "Time period to query" },
        resolution: { type: "string", enum: ["30s", "1m", "5m", "1h"], default: "5m", description: "Time bucket resolution for aggregation" },
      },
    },
  },
  {
    name: "write_fleet_snapshot",
    description: "Write a fleet health snapshot for time-series tracking. Called by the Grid Dispatcher daemon.",
    inputSchema: {
      type: "object" as const,
      properties: {
        activeSessions: {
          type: "object",
          properties: {
            total: { type: "number", description: "Total active sessions" },
            byTier: { type: "object", description: "Sessions grouped by tier" },
            byProgram: { type: "object", description: "Sessions grouped by program" },
          },
          required: ["total"],
        },
        tasksInFlight: { type: "number", description: "Number of tasks currently in flight" },
        messagesPending: { type: "number", description: "Number of pending messages" },
        heartbeatHealth: { type: "number", description: "Heartbeat health score (0-1)" },
      },
      required: ["activeSessions"],
    },
  },
  {
    name: "get_context_utilization",
    description: "Query context window utilization time-series. Returns contextHistory from session docs. If sessionId provided, returns that session; otherwise aggregates across active sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", maxLength: 100, description: "Specific session to query" },
        period: { type: "string", enum: ["today", "this_week", "this_month"], default: "today", description: "Time period to filter context history" },
      },
    },
  },
];
