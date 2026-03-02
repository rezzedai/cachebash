/**
 * Dispatch Domain Registry — Task lifecycle tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getTasksHandler, getTaskByIdHandler, createTaskHandler, claimTaskHandler, unclaimTaskHandler, completeTaskHandler, batchClaimTasksHandler, batchCompleteTasksHandler, getContentionMetricsHandler } from "../modules/dispatch/index.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  get_tasks: getTasksHandler,
  get_task_by_id: getTaskByIdHandler,
  create_task: createTaskHandler,
  claim_task: claimTaskHandler,
  unclaim_task: unclaimTaskHandler,
  complete_task: completeTaskHandler,
  batch_claim_tasks: batchClaimTasksHandler,
  batch_complete_tasks: batchCompleteTasksHandler,
  get_contention_metrics: getContentionMetricsHandler,
};

export const definitions = [
  {
    name: "get_tasks",
    description: "Get tasks created for programs to work on.",
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
    name: "get_task_by_id",
    description: "Get a single task by ID with full details including completion status and result",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The task ID to retrieve" },
      },
      required: ["taskId"],
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
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["taskId", "model", "provider"],
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
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
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
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["taskIds"],
    },
  },
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
];
