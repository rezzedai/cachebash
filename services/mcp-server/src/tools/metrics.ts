/**
 * Metrics Domain Registry — Cost, comms, operational metrics, and rate limit tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler } from "../modules/metrics.js";
import { logRateLimitEventHandler, getRateLimitEventsHandler } from "../modules/rate-limits.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  get_cost_summary: getCostSummaryHandler,
  get_comms_metrics: getCommsMetricsHandler,
  get_operational_metrics: getOperationalMetricsHandler,
  log_rate_limit_event: logRateLimitEventHandler,
  get_rate_limit_events: getRateLimitEventsHandler,
};

export const definitions = [
  {
    name: "get_comms_metrics",
    description: "Get aggregated relay message metrics by period. Counts by status, avg delivery latency, per-program breakdown. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "get_cost_summary",
    description: "Get aggregated cost/token spend for completed tasks. Supports period filtering and grouping by program or type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
        groupBy: { type: "string", enum: ["program", "type", "none"], default: "none", description: "Group results by program (source) or task type" },
        programFilter: { type: "string", maxLength: 100, description: "Filter to a specific program (source field)" },
      },
    },
  },
  {
    name: "get_operational_metrics",
    description: "Get aggregated operational metrics from the telemetry event stream. Task success rates, latency, safety gate stats, delivery health. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "log_rate_limit_event",
    description: "Log a rate limit/throttle event from a session. Written to rate_limit_events collection with 7-day TTL.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", maxLength: 100, description: "Session that encountered the rate limit" },
        modelTier: { type: "string", maxLength: 50, description: "Model tier being rate-limited (e.g., opus, sonnet)" },
        endpoint: { type: "string", maxLength: 200, description: "API endpoint that was throttled" },
        backoffMs: { type: "number", minimum: 0, description: "Backoff duration in milliseconds" },
        cascaded: { type: "boolean", default: false, description: "Whether this rate limit cascaded from another session" },
      },
      required: ["sessionId", "modelTier", "endpoint", "backoffMs"],
    },
  },
  {
    name: "get_rate_limit_events",
    description: "Query rate limit events with optional period and session filtering. Returns events ordered by timestamp desc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month"], default: "this_month", description: "Time period to query" },
        sessionId: { type: "string", maxLength: 100, description: "Filter by session ID" },
      },
    },
  },
];
