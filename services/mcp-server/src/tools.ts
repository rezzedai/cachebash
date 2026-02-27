/**
 * Tool Registry — Maps tool names to handlers + JSON schema definitions.
 * 39 tools across 11 modules (dispatch, relay, pulse, signal, dream, sprint, keys, audit, programState, metrics, trace, rateLimits).
 */

import { AuthContext } from "./auth/authValidator.js";
import { getTasksHandler, createTaskHandler, claimTaskHandler, unclaimTaskHandler, completeTaskHandler, batchClaimTasksHandler, batchCompleteTasksHandler, getContentionMetricsHandler } from "./modules/dispatch.js";
import { sendMessageHandler, getMessagesHandler, getDeadLettersHandler, listGroupsHandler, getSentMessagesHandler, queryMessageHistoryHandler } from "./modules/relay.js";
import { createSessionHandler, updateSessionHandler, listSessionsHandler, getFleetHealthHandler, getContextUtilizationHandler } from "./modules/pulse.js";
import { askQuestionHandler, getResponseHandler, sendAlertHandler } from "./modules/signal.js";
import { dreamPeekHandler, dreamActivateHandler } from "./modules/dream.js";
import { createSprintHandler, updateStoryHandler, addStoryHandler, completeSprintHandler, getSprintHandler } from "./modules/sprint.js";
import { createKeyHandler, revokeKeyHandler, rotateKeyHandler, listKeysHandler } from "./modules/keys.js";
import { getAuditHandler } from "./modules/audit.js";
import { getProgramStateHandler, updateProgramStateHandler } from "./modules/programState.js";
import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler } from "./modules/metrics.js";
import { queryTracesHandler, queryTraceHandler } from "./modules/trace.js";
import { getFleetTimelineHandler, writeFleetSnapshotHandler } from "./modules/fleet-timeline.js";
import { submitFeedbackHandler } from "./modules/feedback.js";
import { logRateLimitEventHandler, getRateLimitEventsHandler } from "./modules/rate-limits.js";
import { getAckComplianceHandler } from "./modules/ack-compliance.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const TOOL_HANDLERS: Record<string, Handler> = {
  // Dispatch
  get_tasks: getTasksHandler,
  create_task: createTaskHandler,
  claim_task: claimTaskHandler,
  unclaim_task: unclaimTaskHandler,
  complete_task: completeTaskHandler,
  batch_claim_tasks: batchClaimTasksHandler,
  batch_complete_tasks: batchCompleteTasksHandler,
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
  rotate_key: rotateKeyHandler,
  list_keys: listKeysHandler,

  // Audit
  get_audit: getAuditHandler,

  // Program State
  get_program_state: getProgramStateHandler,
  update_program_state: updateProgramStateHandler,

  // Metrics
  get_cost_summary: getCostSummaryHandler,
  get_comms_metrics: getCommsMetricsHandler,
  get_operational_metrics: getOperationalMetricsHandler,
  // Fleet
  get_fleet_health: getFleetHealthHandler,
  get_fleet_timeline: getFleetTimelineHandler,
  write_fleet_snapshot: writeFleetSnapshotHandler,

  // Trace
  query_traces: queryTracesHandler,
  query_trace: queryTraceHandler,

  // Feedback
  submit_feedback: submitFeedbackHandler,

  // Rate Limits (Story 2C)
  log_rate_limit_event: logRateLimitEventHandler,
  get_rate_limit_events: getRateLimitEventsHandler,

  // Claim Contention (Story 2D)
  get_contention_metrics: getContentionMetricsHandler,

  // Context Utilization (Story 2E)
  get_context_utilization: getContextUtilizationHandler,

  // ACK Compliance (W1.2.3)
  get_ack_compliance: getAckComplianceHandler,
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
        requires_action: { type: "boolean", description: "Filter by actionability (true = actionable, false = informational)" },
        include_archived: { type: "boolean", default: false, description: "Include auto-archived informational tasks" },
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
        boardItemId: { type: "string", description: "Existing GitHub Projects board item ID to link instead of creating a new issue" },
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
    name: "unclaim_task",
    description: "Unclaim an active task, returning it to created status for re-claiming. Circuit breaker flags tasks with 3+ unclaims.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        reason: { type: "string", enum: ["stale_recovery", "manual", "timeout"], description: "Reason for unclaiming" },
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
        result: { type: "string", maxLength: 4000, description: "Completion summary or result notes" },
        error_code: { type: "string", description: "Error code if failed" },
        error_class: { type: "string", enum: ["TRANSIENT", "PERMANENT", "DEPENDENCY", "POLICY", "TIMEOUT", "UNKNOWN"], description: "Error classification" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "batch_claim_tasks",
    description: "Claim multiple pending tasks in a single call. Each task claims independently (not all-or-nothing).",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskIds: { type: "array", items: { type: "string" }, description: "Array of task IDs to claim", minItems: 1, maxItems: 50 },
        sessionId: { type: "string" },
      },
      required: ["taskIds"],
    },
  },
  {
    name: "batch_complete_tasks",
    description: "Complete multiple tasks in a single call. Each task completes independently (not all-or-nothing).",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskIds: { type: "array", items: { type: "string" }, description: "Array of task IDs to complete", minItems: 1, maxItems: 50 },
        completed_status: { type: "string", enum: ["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"], default: "SUCCESS", description: "Completion outcome (applied to all)" },
        result: { type: "string", maxLength: 4000, description: "Completion summary (applied to all)" },
        model: { type: "string", description: "Model used" },
        provider: { type: "string", description: "Provider" },
      },
      required: ["taskIds"],
    },
  },
  // === Relay ===
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
        payload: { type: "object", description: "Optional structured payload object. Validated against message_type schema (advisory)." },
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
    name: "rotate_key",
    description: "Rotate the calling API key. Atomically creates a new key and grace-expires the old one (30s window).",
    inputSchema: {
      type: "object" as const,
      properties: {},
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
    description: "Query the Gate audit log. Admin only.",
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
    description: "Read a program's persistent operational state. Programs can read their own state; admin/auditor can read any.",
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
          description: "What the program was doing — written on shutdown, read on boot",
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
          description: "Patterns discovered this session — staging area for knowledge store",
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
          description: "Decay configuration",
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
  // === Metrics ===
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
  // === Trace ===
  {
    name: "query_traces",
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
    name: "query_trace",
    description: "Query a complete agent trace by traceId. Fan-out query across tasks, relay messages, and ledger spans. Reconstructs span tree. Admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        traceId: { type: "string", description: "The trace ID to query" },
      },
      required: ["traceId"],
    },
  },
  // === Feedback ===
  {
    name: "submit_feedback",
    description: "Submit feedback (bug report, feature request, or general) which creates a GitHub Issue",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["bug", "feature_request", "general"], default: "general", description: "Feedback type" },
        message: { type: "string", maxLength: 2000, description: "Feedback message (required, 1-2000 chars)" },
        platform: { type: "string", enum: ["ios", "android", "cli"], default: "cli", description: "Submitting platform" },
        appVersion: { type: "string", description: "App version string", maxLength: 50 },
        osVersion: { type: "string", description: "OS version", maxLength: 50 },
        deviceModel: { type: "string", description: "Device model", maxLength: 100 },
      },
      required: ["message"],
    },
  },
  // === Rate Limits (Story 2C) ===
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
  // === Claim Contention (Story 2D) ===
  {
    name: "get_contention_metrics",
    description: "Get task claim contention metrics. Shows claims attempted, won, contention events, and mean time to claim.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  // === Context Utilization (Story 2E) ===
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
  // === ACK Compliance (W1.2.3) ===
  {
    name: "get_ack_compliance",
    description: "Get ACK compliance report. Returns statistics on DIRECTIVE messages and their ACK status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Filter by source program ID" },
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to query" },
      },
    },
  },
];
