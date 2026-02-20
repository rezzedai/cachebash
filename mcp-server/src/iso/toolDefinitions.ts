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
        payload: { type: "object", description: "Optional structured payload. Validated against message_type schema." },
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
    description: "Mark a task as complete (done) or failed",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        tokens_in: { type: "number", description: "Input tokens consumed" },
        tokens_out: { type: "number", description: "Output tokens consumed" },
        cost_usd: { type: "number", description: "Estimated cost in USD" },
        completed_status: { type: "string", enum: ["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"], default: "SUCCESS", description: "Completion outcome" },
        model: { type: "string", description: "Model used (e.g., claude-3.5-sonnet)" },
        provider: { type: "string", description: "Provider (e.g., anthropic, vertex)" },
        error_code: { type: "string", description: "Error code if failed" },
        error_class: { type: "string", enum: ["TRANSIENT", "PERMANENT", "DEPENDENCY", "POLICY", "TIMEOUT", "UNKNOWN"], description: "Error classification" },
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
  {
    name: "get_sent_messages",
    description: "Query sent messages from a program's outbox. ISO can query any source.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by message status" },
        target: { type: "string", maxLength: 100, description: "Filter by target program" },
        threadId: { type: "string", description: "Filter by thread ID" },
        source: { type: "string", maxLength: 100, description: "Source program to query" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "get_comms_metrics",
    description: "Get aggregated relay message metrics by period. Counts by status, avg delivery latency, per-program breakdown.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "get_fleet_health",
    description: "Get health status of all Grid programs. Shows heartbeat age, pending messages/tasks per program.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "query_message_history",
    description: "Query full message history with bodies. Requires at least one of: threadId, source, target.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Filter by thread ID" },
        source: { type: "string", maxLength: 100, description: "Filter by source program" },
        target: { type: "string", maxLength: 100, description: "Filter by target program" },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"] },
        status: { type: "string", description: "Filter by message status" },
        since: { type: "string", description: "Start date (ISO 8601)" },
        until: { type: "string", description: "End date (ISO 8601)" },
        limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
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
    description: "Get aggregated operational metrics from the telemetry event stream. Task success rates, latency, safety gate stats, delivery health. ISO/Flynn only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "query_traces",
    description: "Query execution traces for debugging. Filters: sprintId, taskId, programId, tool, since/until.",
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
    name: "get_sprint",
    description: "Get a sprint's full state including definition, stories, and stats.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string", description: "The sprint ID to fetch" },
      },
      required: ["sprintId"],
    },
  },
];
