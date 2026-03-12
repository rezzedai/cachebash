/**
 * Trace Domain Registry — Execution trace and debugging tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { queryTracesHandler, queryTraceHandler } from "../modules/trace.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  trace_query_traces: queryTracesHandler,
  trace_query_trace: queryTraceHandler,
};

export const definitions = [
  {
    name: "trace_query_traces",
    description: "Query execution traces for debugging. Admin only. Filters: sprintId, taskId, programId, tool, since/until.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string", description: "Filter by sprint ID" },
        taskId: { type: "string", description: "Filter by task ID" },
        programId: { type: "string", maxLength: 100, description: "Filter by program ID" },
        tool: { type: "string", description: "Filter by tool name" },
        since: { type: "string", description: "Start date (ISO 8601)" },
        until: { type: "string", description: "End date (ISO 8601)" },
        limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: "trace_query_trace",
    description: "Query a complete agent trace by traceId. Fan-out query across tasks, relay messages, and ledger spans. Reconstructs span tree. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        traceId: { type: "string", description: "The trace ID to query" },
      },
      required: ["traceId"],
    },
  },
];
