/**
 * Metrics Domain Registry — Cost, comms, operational metrics, and rate limit tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler, getCostForecastHandler, getSlaComplianceHandler, getProgramHealthHandler } from "../modules/metrics.js";
import { logRateLimitEventHandler, getRateLimitEventsHandler } from "../modules/rate-limits.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  metrics_get_cost_summary: getCostSummaryHandler,
  metrics_get_comms_metrics: getCommsMetricsHandler,
  metrics_get_operational_metrics: getOperationalMetricsHandler,
  metrics_log_rate_limit_event: logRateLimitEventHandler,
  metrics_get_rate_limit_events: getRateLimitEventsHandler,
  metrics_get_cost_forecast: getCostForecastHandler,
  metrics_get_sla_compliance: getSlaComplianceHandler,
  metrics_get_program_health: getProgramHealthHandler,
};

export const definitions = [
  {
    name: "metrics_get_comms_metrics",
    description: "Get aggregated relay message metrics by period. Counts by status, avg delivery latency, per-program breakdown. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "metrics_get_cost_summary",
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
    name: "metrics_get_operational_metrics",
    description: "Get aggregated operational metrics from the telemetry event stream. Task success rates, latency, safety gate stats, delivery health. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "metrics_log_rate_limit_event",
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
    name: "metrics_get_rate_limit_events",
    description: "Query rate limit events with optional period and session filtering. Returns events ordered by timestamp desc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month"], default: "this_month", description: "Time period to query" },
        sessionId: { type: "string", maxLength: 100, description: "Filter by session ID" },
      },
    },
  },
  {
    name: "metrics_get_cost_forecast",
    description: "Project monthly spend based on current burn rate. Returns forecasted costs, daily burn rate, and top spending programs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to analyze" },
        forecastDays: { type: "number", minimum: 1, maximum: 365, default: 30, description: "Number of days to forecast" },
      },
    },
  },
  {
    name: "metrics_get_sla_compliance",
    description: "Track whether tasks meet expected completion time based on priority and action type. Returns compliance rate and breach breakdown.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to analyze" },
      },
    },
  },
  {
    name: "metrics_get_program_health",
    description: "Automated health scoring per program based on success rate, latency, error diversity, heartbeat freshness, and cost efficiency. Returns 0-100 health score with recommendations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Filter to specific program (all programs if omitted)" },
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to analyze" },
      },
    },
  },
];
