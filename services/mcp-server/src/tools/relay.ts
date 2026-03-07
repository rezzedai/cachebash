/**
 * Relay Domain Registry — Inter-program messaging tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { sendMessageHandler, getMessagesHandler, getDeadLettersHandler, listGroupsHandler, getSentMessagesHandler, queryMessageHistoryHandler } from "../modules/relay.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  send_message: sendMessageHandler,
  get_messages: getMessagesHandler,
  get_dead_letters: getDeadLettersHandler,
  list_groups: listGroupsHandler,
  get_sent_messages: getSentMessagesHandler,
  query_message_history: queryMessageHistoryHandler,
};

export const definitions = [
  {
    name: "send_message",
    description: "Send a message to another program. Relay v0.2 — requires source, target, message_type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", maxLength: 2000 },
        source: { type: "string", maxLength: 100 },
        target: { type: "string", maxLength: 100, description: "Target program ID or group name (required). Use program name for unicast, or group name for multicast: 'council', 'builders', 'intelligence', 'all'." },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"] },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        context: { type: "string", maxLength: 500 },
        sessionId: { type: "string", description: "Target session ID" },
        reply_to: { type: "string" },
        threadId: { type: "string" },
        ttl: { type: "number", description: "TTL in seconds (default 86400)" },
        payload: { type: "object", description: "Optional structured payload object. Validated against message_type schema." },
        idempotency_key: { type: "string", maxLength: 100, description: "Optional idempotency key (UUID v4 recommended). Prevents duplicate messages on retry. Same key returns cached result." },
      },
      required: ["message", "source", "target", "message_type"],
    },
  },
  {
    name: "get_messages",
    description: "Check for pending messages from programs. Replaces get_interrupts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string" },
        target: { type: "string", description: "Filter by target program ID" },
        markAsRead: { type: "boolean", default: false },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"], description: "Filter by message type" },
        priority: { type: "string", enum: ["low", "normal", "high"], description: "Filter by priority level" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "get_dead_letters",
    description: "View messages that failed delivery. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results to return" },
      },
    },
  },
  {
    name: "list_groups",
    description: "List available multicast groups and their members. Use group names as targets in send_message for multicast.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_sent_messages",
    description: "Query sent messages from a program's outbox. Programs see own sent only; admin can query any source.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by message status" },
        target: { type: "string", maxLength: 100, description: "Filter by target program" },
        threadId: { type: "string", description: "Filter by thread ID" },
        source: { type: "string", maxLength: 100, description: "Source program (admin only — others forced to own)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "query_message_history",
    description: "Query full message history with bodies. Admin only. Requires at least one of: threadId, source, target.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Filter by thread ID" },
        source: { type: "string", maxLength: 100, description: "Filter by source program" },
        target: { type: "string", maxLength: 100, description: "Filter by target program" },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"], description: "Filter by message type" },
        status: { type: "string", description: "Filter by message status" },
        since: { type: "string", description: "Start date (ISO 8601)" },
        until: { type: "string", description: "End date (ISO 8601)" },
        limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
];
