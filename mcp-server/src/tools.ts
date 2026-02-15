/**
 * Tool Registry — Maps tool names to handlers + JSON schema definitions.
 * 23 tools across 8 modules (dispatch, relay, pulse, signal, dream, sprint, keys, audit).
 */

import { AuthContext } from "./auth/apiKeyValidator.js";
import { getTasksHandler, createTaskHandler, claimTaskHandler, completeTaskHandler } from "./modules/dispatch.js";
import { sendMessageHandler, getMessagesHandler, getDeadLettersHandler } from "./modules/relay.js";
import { createSessionHandler, updateSessionHandler, listSessionsHandler } from "./modules/pulse.js";
import { askQuestionHandler, getResponseHandler, sendAlertHandler } from "./modules/signal.js";
import { dreamPeekHandler, dreamActivateHandler, createDreamHandler, killDreamHandler } from "./modules/dream.js";
import { createSprintHandler, updateStoryHandler, addStoryHandler, completeSprintHandler } from "./modules/sprint.js";
import { createKeyHandler, revokeKeyHandler, listKeysHandler } from "./modules/keys.js";
import { getAuditHandler } from "./modules/audit.js";

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
  create_dream: createDreamHandler,
  kill_dream: killDreamHandler,
  // Sprint
  create_sprint: createSprintHandler,
  update_sprint_story: updateStoryHandler,
  add_story_to_sprint: addStoryHandler,
  complete_sprint: completeSprintHandler,

  // Keys
  create_key: createKeyHandler,
  revoke_key: revokeKeyHandler,
  list_keys: listKeysHandler,

  // Audit
  get_audit: getAuditHandler,
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
    description: "Mark a task as complete (done)",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
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
        target: { type: "string", maxLength: 100, description: "Target program ID (required). Use program name or 'all' for broadcast." },
        message_type: { type: "string", enum: ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"] },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        context: { type: "string", maxLength: 500 },
        sessionId: { type: "string", description: "Target session ID" },
        reply_to: { type: "string" },
        threadId: { type: "string" },
        ttl: { type: "number", description: "TTL in seconds (default 86400)" },
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
  {
    name: "create_dream",
    description: "Create a new dream session (Dream Mode). Sets budget cap, timeout, and target program.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", maxLength: 100, description: "Target program to run the dream (e.g., 'basher')" },
        title: { type: "string", maxLength: 200, description: "What to dream about" },
        instructions: { type: "string", maxLength: 4000, description: "Detailed instructions for the dream" },
        branch: { type: "string", maxLength: 100, description: "Git branch for the work" },
        budget_cap_usd: { type: "number", description: "Maximum budget in USD (default: 5, max: 100)" },
        timeout_hours: { type: "number", description: "Maximum duration in hours (default: 8, max: 24)" },
        target: { type: "string", maxLength: 100, description: "Target program ID (defaults to agent)" },
      },
      required: ["agent", "title"],
    },
  },
  {
    name: "kill_dream",
    description: "Kill a running dream session immediately. Emergency stop.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dreamId: { type: "string", description: "ID of the dream task to kill" },
        reason: { type: "string", maxLength: 500, description: "Reason for killing the dream" },
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
            },
            required: ["id", "title"],
          },
        },
        target: { type: "string", maxLength: 100 },
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
];
