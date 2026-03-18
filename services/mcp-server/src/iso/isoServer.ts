/**
 * Admin MCP Server — Scoped endpoint for claude.ai desktop/mobile.
 * Separate MCP Server with whitelisted tools. Auth via Bearer header.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CustomHTTPTransport } from "../transport/CustomHTTPTransport.js";
import { AuthContext } from "../auth/authValidator.js";
import { getTasksHandler, createTaskHandler, claimTaskHandler, completeTaskHandler } from "../modules/dispatch/index.js";
import { getMessagesHandler, sendMessageHandler, getDeadLettersHandler, getSentMessagesHandler, queryMessageHistoryHandler } from "../modules/relay.js";
import { updateSessionHandler, getFleetHealthHandler } from "../modules/pulse.js";
import { sendAlertHandler } from "../modules/signal.js";
import { listKeysHandler } from "../modules/keys.js";
import { getAuditHandler } from "../modules/audit.js";
import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler } from "../modules/metrics.js";
import { checkRateLimit, getRateLimitResetIn } from "../middleware/rateLimiter.js";
import { generateCorrelationId, createAuditLogger } from "../middleware/gate.js";
import { logToolCall } from "../modules/ledger.js";
import { traceToolCall, queryTracesHandler } from "../modules/trace.js";
import { getSprintHandler } from "../modules/sprint.js";
import { ISO_TOOL_DEFINITIONS } from "./toolDefinitions.js";

const ISO_TOOL_HANDLERS: Record<string, (auth: AuthContext, args: any) => Promise<any>> = {
  dispatch_get_tasks: getTasksHandler,
  relay_get_messages: getMessagesHandler,
  relay_get_dead_letters: getDeadLettersHandler,
  pulse_update_session: updateSessionHandler,
  relay_send_message: sendMessageHandler,
  dispatch_create_task: createTaskHandler,
  dispatch_claim_task: claimTaskHandler,
  dispatch_complete_task: completeTaskHandler,
  signal_send_alert: sendAlertHandler,
  keys_list_keys: listKeysHandler,
  audit_get_audit: getAuditHandler,
  metrics_get_cost_summary: getCostSummaryHandler,
  relay_get_sent_messages: getSentMessagesHandler,
  metrics_get_comms_metrics: getCommsMetricsHandler,
  metrics_get_operational_metrics: getOperationalMetricsHandler,
  pulse_get_fleet_health: getFleetHealthHandler,
  relay_query_message_history: queryMessageHistoryHandler,
  trace_query_traces: queryTracesHandler,
  sprint_get_sprint: getSprintHandler,
};

export async function createIsoServer(): Promise<{
  transport: CustomHTTPTransport;
}> {
  const server = new Server(
    { name: "cachebash-iso", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  const transport = new CustomHTTPTransport({
    sessionTimeout: 60 * 60 * 1000,
    enableDnsRebindingProtection: false,
    strictAcceptHeader: false,
    responseQueueTimeout: 2000,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ISO_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const sessionId = extra?.sessionId;
    // Stateless: auth derived from Bearer token via transport.currentAuth (set per-request)
    const authContext = transport.currentAuth as AuthContext | null;
    const correlationId = generateCorrelationId();
    const audit = createAuditLogger(correlationId, authContext?.userId || "unknown");
    const startTime = Date.now();

    if (!authContext) {
      return {
        content: [{ type: "text", text: "Error: Not authenticated." }],
        isError: true,
      };
    }

    if (!checkRateLimit(authContext.userId, name)) {
      const resetIn = Math.ceil(getRateLimitResetIn(authContext.userId, name) / 1000);
      return {
        content: [{ type: "text", text: `Rate limit exceeded for ${name}. Try again in ${resetIn} seconds.` }],
        isError: true,
      };
    }

    const handler = ISO_TOOL_HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `Tool "${name}" is not available on the admin endpoint.` }],
        isError: true,
      };
    }

    try {
      const result = await handler(authContext, args);
      const durationMs = Date.now() - startTime;
      logToolCall(authContext.userId, name, authContext.programId, "admin", sessionId, durationMs, true);
      traceToolCall(authContext.userId, name, authContext.programId, "admin", sessionId, args,
        JSON.stringify(result).substring(0, 500), durationMs, true);
      audit.log(name, { tool: name, programId: authContext.programId, source: authContext.programId, endpoint: "admin" });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logToolCall(authContext.userId, name, authContext.programId, "admin", sessionId, durationMs, false,
        error instanceof Error ? error.message : String(error));
      traceToolCall(authContext.userId, name, authContext.programId, "admin", sessionId, args,
        "", durationMs, false, error instanceof Error ? error.message : String(error));
      audit.error(name, error instanceof Error ? error.message : String(error), { tool: name, programId: authContext.programId, source: authContext.programId, endpoint: "admin" });
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  await server.connect(transport);
  return { transport };
}
