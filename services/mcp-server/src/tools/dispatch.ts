/**
 * Dispatch Domain Registry — Task lifecycle tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getTasksHandler, getTaskByIdHandler, createTaskHandler, claimTaskHandler, unclaimTaskHandler, completeTaskHandler, batchClaimTasksHandler, batchCompleteTasksHandler, getContentionMetricsHandler, dispatchHandler, retryTaskHandler, abortTaskHandler, reassignTaskHandler, escalateTaskHandler, quarantineProgramHandler, unquarantineProgramHandler, replayTaskHandler, approveTaskHandler, getTaskLineageHandler, exportTasksHandler, suggestTargetHandler, recordTaskTelemetryHandler, backfillTaskExpiresAtHandler, reapExpiredTasksHandler } from "../modules/dispatch/index.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  dispatch_get_tasks: getTasksHandler,
  dispatch_get_task_by_id: getTaskByIdHandler,
  dispatch_create_task: createTaskHandler,
  dispatch_claim_task: claimTaskHandler,
  dispatch_unclaim_task: unclaimTaskHandler,
  dispatch_complete_task: completeTaskHandler,
  dispatch_record_task_telemetry: recordTaskTelemetryHandler,
  dispatch_batch_claim_tasks: batchClaimTasksHandler,
  dispatch_batch_complete_tasks: batchCompleteTasksHandler,
  dispatch_get_contention_metrics: getContentionMetricsHandler,
  dispatch_dispatch: dispatchHandler,
  dispatch_retry_task: retryTaskHandler,
  dispatch_abort_task: abortTaskHandler,
  dispatch_reassign_task: reassignTaskHandler,
  dispatch_escalate_task: escalateTaskHandler,
  dispatch_quarantine_program: quarantineProgramHandler,
  dispatch_unquarantine_program: unquarantineProgramHandler,
  dispatch_replay_task: replayTaskHandler,
  dispatch_approve_task: approveTaskHandler,
  dispatch_get_task_lineage: getTaskLineageHandler,
  dispatch_export_tasks: exportTasksHandler,
  dispatch_suggest_target: suggestTargetHandler,
  dispatch_backfill_task_expires_at: backfillTaskExpiresAtHandler,
  dispatch_reap_expired_tasks: reapExpiredTasksHandler,
};

export const definitions = [
  {
    name: "dispatch_get_tasks",
    description: "Get tasks created for programs to work on. Boot default: requires_action=true (actionable only), titles+IDs only (fetch body via get_task_by_id).",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["created", "active", "all"], default: "created", description: "Filter by lifecycle status" },
        type: { type: "string", enum: ["task", "question", "dream", "sprint", "sprint-story", "all"], default: "all" },
        target: { type: "string", description: "Filter by target program ID", maxLength: 100 },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
        requires_action: { type: ["boolean", "null"], default: true, description: "true=actionable only (default), false=informational only, null=no filter" },
        include_archived: { type: "boolean", default: false, description: "Include auto-archived informational tasks" },
        include_instructions: { type: "boolean", default: false, description: "Include full instruction bodies. Default false keeps boot payload small; fetch body on demand via get_task_by_id." },
      },
    },
  },
  {
    name: "dispatch_get_task_by_id",
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
    name: "dispatch_create_task",
    description: "Create a new task for a program to work on. STATUS tasks auto-archive on create. RESULT (non-failed) tasks auto-complete to done.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", maxLength: 200 },
        instructions: { type: "string", maxLength: 32000 },
        message_type: { type: "string", enum: ["DIRECTIVE", "QUERY", "HANDSHAKE", "ACK", "STATUS", "PING", "PONG", "RESULT"], description: "Message type — drives requires_action classification and STATUS/RESULT drain semantics" },
        type: { type: "string", enum: ["task", "question", "dream", "sprint", "sprint-story"], default: "task" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "queue" },
        source: { type: "string", maxLength: 100 },
        target: { type: "string", maxLength: 100, description: "Target program ID (required). Use program name or 'all' for broadcast." },
        projectId: { type: "string" },
        boardItemId: { type: "string", description: "Existing GitHub Projects board item ID to link instead of creating a new issue" },
        ttl: { type: "number", minimum: 0, maximum: 31536000, description: "Task lifetime in seconds. 0 is the never-expires sentinel (resolves to 2099-01-01T00:00:00Z). Omit to use the default: 86400s (24h) for type:\"task\", or the never-expires sentinel for any other type." },
        replyTo: { type: "string", description: "Task ID this responds to" },
        threadId: { type: "string", description: "Conversation thread grouping" },
        provenance: { type: "object", properties: { model: { type: "string" }, cost_tokens: { type: "number" }, confidence: { type: "number" } } },
        fallback: { type: "array", items: { type: "string" }, description: "Fallback targets" },
      },
      required: ["title", "target"],
    },
  },
  {
    name: "dispatch_claim_task",
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
    name: "dispatch_unclaim_task",
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
    name: "dispatch_complete_task",
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
    name: "dispatch_batch_claim_tasks",
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
    name: "dispatch_record_task_telemetry",
    description: "Record measured token/cost telemetry on a completed task (fill-if-null; never overwrites self-reported values). For host-side telemetry hooks. Completing program or admin only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        tokens_in: { type: "number", minimum: 0 },
        tokens_out: { type: "number", minimum: 0 },
        cost_usd: { type: "number", minimum: 0 },
        model: { type: "string" },
        provider: { type: "string" },
        telemetry_source: { type: "string", maxLength: 100, default: "host-hook" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "dispatch_batch_complete_tasks",
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
    name: "dispatch_get_contention_metrics",
    description: "Get task claim contention metrics. Shows claims attempted, won, contention events, and mean time to claim.",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "this_week", "this_month", "all"], default: "this_month", description: "Time period to aggregate" },
      },
    },
  },
  {
    name: "dispatch_dispatch",
    description: "Dispatch work to a target program with enforced pre-flight checks, durable obligation persistence, auto-wake, and uptake verification. Canonical dispatch API: returns success only when the target claims the task or ACKs the directive; otherwise returns a tracked pending handle.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string", maxLength: 100, description: "Sending program ID" },
        target: { type: "string", maxLength: 100, description: "Target program ID (required). The program that should receive and execute the work." },
        title: { type: "string", maxLength: 200, description: "Task title — concise description of the work" },
        instructions: { type: "string", maxLength: 32000, description: "Full task instructions with context, constraints, and acceptance criteria" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "high", description: "Task priority (default: high)" },
        action: { type: "string", enum: ["interrupt", "sprint", "parallel", "queue", "backlog"], default: "interrupt", description: "Task action classification (default: interrupt)" },
        policy_mode: { type: "string", enum: ["normal", "supervised", "strict"], default: "normal", description: "Execution policy mode. normal: standard execution; supervised: requires approval before done; strict: governance warnings block dispatch (default: normal)" },
        waitForUptake: { type: "boolean", default: true, description: "Wait for target to claim or ACK before returning (default: true). Set false only to store a pending obligation handle; response success remains false until confirmed uptake." },
        uptakeTimeoutSeconds: { type: "number", minimum: 5, maximum: 120, default: 45, description: "Seconds to wait for uptake confirmation (default: 45)" },
        autoWake: { type: "boolean", default: true, description: "Trigger wake daemon if target is stale/absent (default: true)" },
        ttl: { type: "number", minimum: 0, maximum: 31536000, description: "Task lifetime in seconds. 0 is the never-expires sentinel (opts out of reaping — resolves to 2099-01-01T00:00:00Z). Omit to use the action-based default: 604800s (7d) for action:\"interrupt\", 86400s (24h) otherwise." },
        idempotency_key: { type: "string", maxLength: 100, description: "Optional idempotency key. Reuse returns the existing dispatch obligation instead of creating duplicate task/directive work." },
        threadId: { type: "string", description: "Optional conversation thread grouping" },
        projectId: { type: "string", description: "Optional project ID" },
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["source", "target", "title"],
    },
  },
  {
    name: "dispatch_retry_task",
    description: "Retry a failed or completed task. Resets the task to created status for re-claiming. Optionally updates target program and/or priority.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to retry" },
        newTarget: { type: "string", maxLength: 100, description: "Optional new target program for retry" },
        newPriority: { type: "string", enum: ["low", "normal", "high"], description: "Optional new priority for retry" },
        reason: { type: "string", maxLength: 500, description: "Reason for retry" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "dispatch_abort_task",
    description: "Abort a running or pending task. Marks the task as permanently cancelled (different from unclaim which requeues).",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to abort" },
        reason: { type: "string", maxLength: 500, description: "Reason for aborting the task" },
      },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "dispatch_reassign_task",
    description: "Reassign a task to a different program without losing context. Preserves original source and instructions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to reassign" },
        newTarget: { type: "string", maxLength: 100, description: "New target program ID" },
        reason: { type: "string", maxLength: 500, description: "Reason for reassignment" },
      },
      required: ["taskId", "newTarget", "reason"],
    },
  },
  {
    name: "dispatch_escalate_task",
    description: "Escalate a task's priority and/or route it up the chain. Default chain: builder → iso → vector → Flynn.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to escalate" },
        newPriority: { type: "string", enum: ["low", "normal", "high"], description: "New priority (defaults to high)" },
        escalateTo: { type: "string", maxLength: 100, description: "Specific escalation target (optional, uses default chain if omitted)" },
        reason: { type: "string", maxLength: 500, description: "Reason for escalation" },
      },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "dispatch_quarantine_program",
    description: "Quarantine a program to block all task dispatches. Used for programs experiencing repeated failures. Requires dispatch.write capability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Program ID to quarantine" },
        reason: { type: "string", maxLength: 500, description: "Reason for quarantine" },
      },
      required: ["programId", "reason"],
    },
  },
  {
    name: "dispatch_unquarantine_program",
    description: "Unquarantine a program to restore task dispatch. Resets failure count. Requires dispatch.write capability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Program ID to unquarantine" },
      },
      required: ["programId"],
    },
  },
  {
    name: "dispatch_replay_task",
    description: "Replay a completed task with optional modifications. Creates a new task cloned from the original with links preserved. Use this to re-execute tasks with modified instructions, different targets, or changed priorities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Original task ID to replay" },
        modifiedInstructions: { type: "string", maxLength: 32000, description: "Optional modified instructions for the replayed task" },
        newTarget: { type: "string", maxLength: 100, description: "Optional new target program for the replayed task" },
        newPriority: { type: "string", enum: ["low", "normal", "high"], description: "Optional new priority for the replayed task" },
        reason: { type: "string", maxLength: 500, description: "Reason for replay" },
      },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "dispatch_approve_task",
    description: "Approve a task in supervised mode. Transitions task from completing → done. Only works on tasks with policy_mode=supervised that are awaiting approval.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to approve" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "dispatch_get_task_lineage",
    description: "Query the lineage chain of a task. Returns ancestors (tasks this was replayed/retried/reassigned/escalated from) and descendants (tasks derived from this one). Also returns the state transition log.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Task ID to query lineage for" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "dispatch_export_tasks",
    description: "Export tasks with full details including lineage fields and state transitions. Supports filtering by status and date range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        format: { type: "string", enum: ["json"], default: "json", description: "Export format (currently json only)" },
        status: { type: "string", description: "Optional status filter (created, active, done, failed, etc.)" },
        since: { type: "string", description: "Optional ISO 8601 date. Only return tasks created on or after this date." },
        limit: { type: "number", minimum: 1, maximum: 500, default: 100, description: "Max tasks to return (default 100, max 500)" },
      },
    },
  },
  {
    name: "dispatch_suggest_target",
    description: "Wave 16: Suggest optimal target programs based on historical success rates. Returns ranked list of programs with success rates for matching task characteristics. Requires dispatch.read capability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskType: { type: "string", description: "Task type to match (e.g., 'task', 'question', 'dream'). Defaults to 'task'." },
        title: { type: "string", description: "Optional task title for context" },
        instructions: { type: "string", description: "Optional task instructions for context" },
      },
    },
  },
  {
    name: "dispatch_backfill_task_expires_at",
    description: "PLAN-W1: fleet-internal only. Scans the caller's tasks collection for documents with no expiresAt field, classifies each via the reviewed classifyForBackfill() rule, and (only when execute:true) writes expiresAt onto them in batches of <=400 -- never overwrites a doc that already has the field, never touches any other field. Dry-run (execute:false) by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        execute: { type: "boolean", default: false, description: "false (default) = dry-run report only. true = actually write expiresAt." },
        limit: { type: "number", minimum: 1, maximum: 20000, description: "Cap how many field-less docs this call classifies (dry-run) or writes (execute), to stage a rollout. Omitted = no cap." },
      },
    },
  },
  {
    name: "dispatch_reap_expired_tasks",
    description: "PLAN-W4: fleet-internal only. Scans the caller's tasks collection for documents where expiresAt EXISTS and is <= now, and (only when execute:true) deletes them in batches of <=400. NEVER deletes a document lacking expiresAt (W4-R1). Dry-run (execute:false) by default -- reports scanned/fieldLessCount/liveWithExpiry/expiredCandidates/bySource without writing. Optional cohortSource narrows deletion to one `source` value for a staged rollout; the dry-run's bySource breakdown always reports the true, un-narrowed cohort sizes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        execute: { type: "boolean", default: false, description: "false (default) = dry-run report only. true = actually delete." },
        cohortSource: { type: "string", maxLength: 100, description: "Narrow deletion to docs with this exact `source` value (staged rollout). Omitted = every expired doc is a candidate." },
        limit: { type: "number", minimum: 1, maximum: 50000, description: "Cap how many delete candidates this call processes. Omitted = no cap." },
      },
    },
  },
];
