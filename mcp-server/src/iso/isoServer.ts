/**
 * ISO MCP Server — Scoped endpoint for claude.ai desktop/mobile.
 * Separate MCP Server with whitelisted tools. Auth via Bearer header.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CustomHTTPTransport } from "../transport/CustomHTTPTransport.js";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { getTasksHandler, createTaskHandler, claimTaskHandler, completeTaskHandler } from "../modules/dispatch.js";
import { getMessagesHandler, sendMessageHandler } from "../modules/relay.js";
import { updateSessionHandler } from "../modules/pulse.js";
import { sendAlertHandler } from "../modules/signal.js";
import { checkRateLimit, getRateLimitResetIn } from "../middleware/rateLimiter.js";
import { generateCorrelationId, createAuditLogger } from "../middleware/gate.js";
import { logToolCall } from "../modules/ledger.js";
import { ISO_TOOL_DEFINITIONS } from "./toolDefinitions.js";

const ISO_TOOL_HANDLERS: Record<string, (auth: AuthContext, args: any) => Promise<any>> = {
  get_tasks: getTasksHandler,
  get_messages: getMessagesHandler,
  update_session: updateSessionHandler,
  send_message: sendMessageHandler,
  create_task: createTaskHandler,
  claim_task: claimTaskHandler,
  complete_task: completeTaskHandler,
  send_alert: sendAlertHandler,
};

const isoSessions = new Map<string, { authContext: AuthContext; lastActivity: number }>();

const isoSessionAuth = {
  get: (sessionId: string) => isoSessions.get(sessionId)?.authContext,
  set: (sessionId: string, auth: AuthContext) => {
    isoSessions.set(sessionId, { authContext: auth, lastActivity: Date.now() });
  },
};

export async function createIsoServer(): Promise<{
  transport: CustomHTTPTransport;
  sessions: typeof isoSessions;
}> {
  const server = new Server(
    { name: "cachebash-iso", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ISO_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const sessionId = extra?.sessionId;
    const authContext = sessionId ? isoSessionAuth.get(sessionId) : null;
    const correlationId = generateCorrelationId();
    const startTime = Date.now();

    if (!authContext) {
      return {
        content: [{ type: "text", text: "Error: Not authenticated." }],
        isError: true,
      };
    }

    if (sessionId && isoSessions.has(sessionId)) {
      isoSessions.get(sessionId)!.lastActivity = Date.now();
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
        content: [{ type: "text", text: `Tool "${name}" is not available on the ISO endpoint.` }],
        isError: true,
      };
    }

    try {
      const result = await handler(authContext, args);
      const durationMs = Date.now() - startTime;
      logToolCall(authContext.userId, name, "iso", sessionId, durationMs, true);
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logToolCall(authContext.userId, name, "iso", sessionId, durationMs, false,
        error instanceof Error ? error.message : String(error));
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  const transport = new CustomHTTPTransport({
    sessionTimeout: 60 * 60 * 1000,
    enableDnsRebindingProtection: false,
    strictAcceptHeader: false,
    responseQueueTimeout: 2000,
  });

  await server.connect(transport);
  return { transport, sessions: isoSessions };
}

export function setIsoSessionAuth(sessionId: string, auth: AuthContext): void {
  isoSessionAuth.set(sessionId, auth);
}

export function cleanupIsoSessions(timeoutMs: number): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, info] of isoSessions.entries()) {
    if (now - info.lastActivity > timeoutMs) {
      isoSessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}
