/**
 * ISO Tool Definitions — JSON schema for whitelisted tools.
 * These are the tools available on the ISO (claude.ai) endpoint.
 */

export const ISO_TOOL_DEFINITIONS = [
  {
    name: "get_tasks",
    description: "Get tasks created for programs to work on",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["created", "active", "all"], default: "created" },
        type: { type: "string", enum: ["task", "question", "dream", "sprint", "sprint-story", "all"], default: "all" },
        target: { type: "string", description: "Filter by target program ID", maxLength: 100 },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: "get_messages",
    description: "Check for pending messages from programs",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session ID to check messages for" },
        target: { type: "string", description: "Target program ID to filter by" },
        markAsRead: { type: "boolean", default: true },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"], description: "Filter by message type" },
        priority: { type: "string", enum: ["low", "normal", "high"], description: "Filter by priority level" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "get_dead_letters",
    description: "View messages that failed delivery. ISO and Flynn only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results to return" },
      },
    },
  },
  {
    name: "update_session",
    description: "Update working status visible in the app",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", maxLength: 200 },
        sessionId: { type: "string" },
        state: { type: "string", enum: ["working", "blocked", "complete", "pinned"], default: "working" },
        progress: { type: "number", minimum: 0, maximum: 100 },
        projectName: { type: "string", maxLength: 100 },
        lastHeartbeat: { type: "boolean", description: "Also update heartbeat timestamp" },
      },
      required: ["status"],
    },
  },
  {
    name: "send_message",
    description: "Send a message to a running program. Grid Relay v0.2.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", maxLength: 2000 },
        source: { type: "string", maxLength: 100 },
        target: { type: "string", maxLength: 100, description: "Target program ID (required). Use program name or 'all' for broadcast." },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"] },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        context: { type: "string", maxLength: 500 },
        sessionId: { type: "string" },
        reply_to: { type: "string" },
      },
      required: ["message", "source", "target", "message_type"],
    },
  },
  {
    name: "create_task",
    description: "Create a new task for a program to work on",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", maxLength: 200 },
        instructions: { type: "string", maxLength: 4000 },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        source: { type: "string", maxLength: 100 },
        target: { type: "string", maxLength: 100, description: "Target program ID (required). Use program name or 'all' for broadcast." },
        projectId: { type: "string" },
      },
      required: ["title", "target"],
    },
  },
  {
    name: "claim_task",
    description: "Claim a pending task to start working on it",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        sessionId: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as complete",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "send_alert",
    description: "Send an alert notification to the user's mobile device",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", maxLength: 2000 },
        alertType: { type: "string", enum: ["error", "warning", "success", "info"], default: "info" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        context: { type: "string", maxLength: 500 },
        sessionId: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "list_keys",
    description: "List all API keys for the authenticated user. Returns metadata, never raw keys.",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeRevoked: { type: "boolean", default: false, description: "Include revoked keys in results" },
      },
    },
  },
  {
    name: "get_audit",
    description: "Query the Gate audit log. ISO and Flynn only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", minimum: 1, maximum: 100, default: 50, description: "Max results" },
        allowed: { type: "boolean", description: "Filter by allowed (true) or denied (false)" },
        programId: { type: "string", maxLength: 100, description: "Filter by program ID" },
      },
    },
  },
];
