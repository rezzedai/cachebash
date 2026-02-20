/**
 * Tool Registry — Maps tool names to handlers + JSON schema definitions.
 * 25 tools across 9 modules (dispatch, relay, pulse, signal, dream, sprint, keys, audit, programState).
 */

import { AuthContext } from "./auth/apiKeyValidator.js";
import { getTasksHandler, createTaskHandler, claimTaskHandler, completeTaskHandler } from "./modules/dispatch.js";
import { sendMessageHandler, getMessagesHandler, getDeadLettersHandler, listGroupsHandler, getSentMessagesHandler, queryMessageHistoryHandler } from "./modules/relay.js";
import { createSessionHandler, updateSessionHandler, listSessionsHandler, getFleetHealthHandler } from "./modules/pulse.js";
import { askQuestionHandler, getResponseHandler, sendAlertHandler } from "./modules/signal.js";
import { dreamPeekHandler, dreamActivateHandler } from "./modules/dream.js";
import { createSprintHandler, updateStoryHandler, addStoryHandler, completeSprintHandler, getSprintHandler } from "./modules/sprint.js";
import { createKeyHandler, revokeKeyHandler, listKeysHandler } from "./modules/keys.js";
import { getAuditHandler } from "./modules/audit.js";
import { getProgramStateHandler, updateProgramStateHandler } from "./modules/programState.js";
import { getCostSummaryHandler, getCommsMetricsHandler } from "./modules/metrics.js";
import { queryTracesHandler } from "./modules/trace.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const TOOL_HANDLERS: Record<string, Handler> = {
  // Dispatch
  get_tasks: getTasksHandler,
  create_task: createTaskHandler,
  claim_task: claimTaskHandler,
  complete_task: completeTaskHandler,
  // Relay
  send_message: sendMessageHandler,
  get_messages: getMessagesHandler,
  get_dead_letters: getDeadLettersHandler,
  list_groups: listGroupsHandler,
  get_sent_messages: getSentMessagesHandler,
  query_message_history: queryMessageHistoryHandler,
  // Pulse
  create_session: createSessionHandler,
  update_session: updateSessionHandler,
  list_sessions: listSessionsHandler,
  // Signal
  ask_question: askQuestionHandler,
  get_response: getResponseHandler,
  send_alert: sendAlertHandler,
  // Dream
  dream_peek: dreamPeekHandler,
  dream_activate: dreamActivateHandler,
  // Sprint
  create_sprint: createSprintHandler,
  update_sprint_story: updateStoryHandler,
  add_story_to_sprint: addStoryHandler,
  complete_sprint: completeSprintHandler,
  get_sprint: getSprintHandler,

  // Keys
  create_key: createKeyHandler,
  revoke_key: revokeKeyHandler,
  list_keys: listKeysHandler,

  // Audit
  get_audit: getAuditHandler,

  // Program State
  get_program_state: getProgramStateHandler,
  update_program_state: updateProgramStateHandler,

  // Metrics
  get_cost_summary: getCostSummaryHandler,
  get_comms_metrics: getCommsMetricsHandler,
  // Fleet
  get_fleet_health: getFleetHealthHandler,

  // Trace
  query_traces: queryTracesHandler,
};

export const TOOL_DEFINITIONS = [
  // === Dispatch ===
  {
    name: "get_tasks",
    description: "Get tasks created for programs to work on. Replaces get_pending_tasks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["created", "active", "all"], default: "created", description: "Filter by lifecycle status" },
        type: { type: "string", enum: ["task", "question", "dream", "sprint", "sprint-story", "all"], default: "all" },
        target: { type: "string", description: "Filter by target program ID", maxLength: 100 },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      },
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
        type: { type: "string", enum: ["task", "question", "dream", "sprint", "sprint-story"], default: "task" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        source: { type: "string", maxLength: 100 },
        target: { type: "string", maxLength: 100, description: "Target program ID (required). Use program name or 'all' for broadcast." },
        projectId: { type: "string" },
        ttl: { type: "number", description: "Seconds until expiry" },
        replyTo: { type: "string", description: "Task ID this responds to" },
        threadId: { type: "string", description: "Conversation thread grouping" },
        provenance: { type: "object", properties: { model: { type: "string" }, cost_tokens: { type: "number" }, confidence: { type: "number" } } },
        fallback: { type: "array", items: { type: "string" }, description: "Fallback targets" },
      },
      required: ["title", "target"],
    },
  },
  {
    name: "claim_task",
    description: "Claim a pending task to start working on it. Uses transactions to prevent double-claiming.",
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
  // === Relay ===
  {
    name: "send_message",
    description: "Send a message to another program. Grid Relay v0.2 — requires source, target, message_type.",
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
        payload: { type: "object", description: "Optional structured payload object. Validated against message_type schema (advisory)." },
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
    name: "list_groups",
    description: "List available multicast groups and their members. Use group names as targets in send_message for multicast.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_sent_messages",
    description: "Query sent messages from a program's outbox. Programs see own sent only; ISO/Flynn can query any source.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by message status" },
        target: { type: "string", maxLength: 100, description: "Filter by target program" },
        threadId: { type: "string", description: "Filter by thread ID" },
        source: { type: "string", maxLength: 100, description: "Source program (ISO/Flynn only — others forced to own)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "query_message_history",
    description: "Query full message history with bodies. ISO/Flynn only. Requires at least one of: threadId, source, target.",
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
  // === Pulse ===
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
  // === Signal ===
  {
    name: "ask_question",
    description: "Send a question to the user's mobile device and wait for a response",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", maxLength: 2000 },
        options: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 5 },
        context: { type: "string", maxLength: 500 },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        encrypt: { type: "boolean", default: true },
        threadId: { type: "string" },
        inReplyTo: { type: "string" },
        projectId: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "get_response",
    description: "Check if the user has responded to a question",
    inputSchema: {
      type: "object" as const,
      properties: {
        questionId: { type: "string" },
      },
      required: ["questionId"],
    },
  },
  {
    name: "send_alert",
    description: "Send an alert notification to the user's mobile device (one-way, no response needed)",
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
  // === Dream ===
  {
    name: "dream_peek",
    description: "Check for pending dream sessions (lightweight check for shell hooks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "dream_activate",
    description: "Atomically activate a dream session",
    inputSchema: {
      type: "object" as const,
      properties: {
        dreamId: { type: "string" },
      },
      required: ["dreamId"],
    },
  },
  // === Sprint ===
  {
    name: "create_sprint",
    description: "Create a new sprint to track parallel story execution",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectName: { type: "string", maxLength: 100 },
        branch: { type: "string", maxLength: 100 },
        stories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              wave: { type: "number" },
              dependencies: { type: "array", items: { type: "string" } },
              complexity: { type: "string", enum: ["normal", "high"] },
              retryPolicy: { type: "string", enum: ["none", "auto_retry", "escalate"], default: "none" },
              maxRetries: { type: "number", minimum: 0, maximum: 5, default: 1 },
            },
            required: ["id", "title"],
          },
        },
        sessionId: { type: "string" },
        config: {
          type: "object",
          properties: {
            orchestratorModel: { type: "string" },
            subagentModel: { type: "string" },
            maxConcurrent: { type: "number" },
          },
        },
      },
      required: ["projectName", "branch", "stories"],
    },
  },
  {
    name: "update_sprint_story",
    description: "Update a story's progress within a sprint",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        storyId: { type: "string" },
        status: { type: "string", enum: ["queued", "active", "complete", "failed", "skipped"] },
        progress: { type: "number", minimum: 0, maximum: 100 },
        currentAction: { type: "string", maxLength: 200 },
        model: { type: "string" },
      },
      required: ["sprintId", "storyId"],
    },
  },
  {
    name: "add_story_to_sprint",
    description: "Add a new story to a running sprint",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        story: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            dependencies: { type: "array", items: { type: "string" } },
            complexity: { type: "string", enum: ["normal", "high"] },
          },
          required: ["id", "title"],
        },
        insertionMode: { type: "string", enum: ["current_wave", "next_wave", "backlog"], default: "next_wave" },
      },
      required: ["sprintId", "story"],
    },
  },
  {
    name: "complete_sprint",
    description: "Mark a sprint as complete",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        summary: {
          type: "object",
          properties: {
            completed: { type: "number" },
            failed: { type: "number" },
            skipped: { type: "number" },
            duration: { type: "number" },
          },
        },
      },
      required: ["sprintId"],
    },
  },
  {
    name: "get_sprint",
    description: "Get a sprint's full state including definition, stories, and stats. Any authenticated program can read.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string", description: "The sprint ID to fetch" },
      },
      required: ["sprintId"],
    },
  },
  // === Keys ===
  {
    name: "create_key",
    description: "Create a new per-program API key. Returns the raw key (only shown once).",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program this key authenticates as", maxLength: 50 },
        label: { type: "string", description: "Human-readable label for key management", maxLength: 200 },
      },
      required: ["programId", "label"],
    },
  },
  {
    name: "revoke_key",
    description: "Revoke an API key by its hash. Soft revoke — key stays in DB for audit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keyHash: { type: "string", description: "SHA-256 hash of the key to revoke" },
      },
      required: ["keyHash"],
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
  // === Audit ===
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
  // === Program State ===
  {
    name: "get_program_state",
    description: "Read a program's persistent operational state. Programs can read their own state; SARK/ISO can read any.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to read state for", maxLength: 100 },
      },
      required: ["programId"],
    },
  },
  {
    name: "update_program_state",
    description: "Write a program's persistent operational state. Programs can only write their own state. Partial updates merge with existing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to update state for", maxLength: 100 },
        sessionId: { type: "string", description: "CacheBash session ID writing this state", maxLength: 100 },
        contextSummary: {
          type: "object",
          description: "What the program was doing — written on derez, read on boot",
          properties: {
            lastTask: {
              type: "object",
              nullable: true,
              properties: {
                taskId: { type: "string" },
                title: { type: "string", maxLength: 200 },
                outcome: { type: "string", enum: ["completed", "in_progress", "blocked", "deferred"] },
                notes: { type: "string", maxLength: 2000 },
              },
              required: ["taskId", "title", "outcome", "notes"],
            },
            activeWorkItems: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 20 },
            handoffNotes: { type: "string", maxLength: 2000 },
            openQuestions: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 10 },
          },
        },
        learnedPatterns: {
          type: "array",
          description: "Patterns discovered this session — staging area for RAM",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              domain: { type: "string", maxLength: 100 },
              pattern: { type: "string", maxLength: 500 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", maxLength: 500 },
              discoveredAt: { type: "string" },
              lastReinforced: { type: "string" },
              promotedToStore: { type: "boolean" },
              stale: { type: "boolean" },
            },
            required: ["id", "domain", "pattern", "confidence", "evidence", "discoveredAt", "lastReinforced"],
          },
        },
        config: {
          type: "object",
          description: "Runtime preferences (not the spec — those are in git)",
          properties: {
            preferredOutputFormat: { type: "string", maxLength: 100, nullable: true },
            toolPreferences: { type: "object", description: "Key-value tool preferences" },
            knownQuirks: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 20 },
            customSettings: { type: "object", description: "Program-specific key-value pairs" },
          },
        },
        baselines: {
          type: "object",
          description: "Performance baselines for self-assessment",
          properties: {
            avgTaskDurationMinutes: { type: "number", nullable: true },
            commonFailureModes: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 10 },
            sessionsCompleted: { type: "number", minimum: 0 },
            lastSessionDurationMinutes: { type: "number", nullable: true },
          },
        },
        decay: {
          type: "object",
          description: "Decay configuration (SARK 15c)",
          properties: {
            contextSummaryTTLDays: { type: "number", minimum: 1, maximum: 90 },
            learnedPatternMaxAge: { type: "number", minimum: 1, maximum: 365 },
            maxUnpromotedPatterns: { type: "number", minimum: 5, maximum: 200 },
          },
        },
      },
      required: ["programId"],
    },
  },
  // === Fleet ===
  {
    name: "get_fleet_health",
    description: "Get health status of all Grid programs. Shows heartbeat age, pending messages/tasks per program. ISO/Flynn only.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  // === Metrics ===
  {
    name: "get_comms_metrics",
    description: "Get aggregated relay message metrics by period. Counts by status, avg delivery latency, per-program breakdown. ISO/Flynn only.",
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
  // === Trace ===
  {
    name: "query_traces",
    description: "Query execution traces for debugging. ISO/Flynn only. Filters: sprintId, taskId, programId, tool, since/until.",
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
];
