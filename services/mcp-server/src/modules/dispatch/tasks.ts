/**
 * Dispatch Module — Task CRUD (get_tasks, create_task).
 * Collection: tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { verifySource } from "../../middleware/gate.js";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import { isGroupTarget } from "../../config/programs.js";
import { isProgramRegistered } from "../programRegistry.js";
import { syncTaskCreated } from "../github-sync.js";
import { emitEvent, classifyTask, type TaskClass } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { generateSpanId } from "../../utils/trace.js";
import { notifyDispatcher } from "../../webhooks/dispatcher-notify.js";
import { type ToolResult, jsonResult, decryptTaskFields } from "./shared.js";
import { CONSTANTS } from "../../config/constants.js";

const GetTasksSchema = z.object({
  status: z.enum(["created", "active", "all"]).default("created"),
  type: z.enum(["task", "question", "dream", "sprint", "sprint-story", "all"]).default("all"),
  target: z.string().max(100).optional(),
  limit: z.number().min(1).max(50).default(10),
  // Default true: boot queries scope to actionable tasks only. Pass false for informational tasks,
  // null to bypass the filter entirely (audit/export use cases).
  requires_action: z.boolean().nullable().default(true),
  include_archived: z.boolean().default(false),
  // Default false: omit instruction bodies to keep boot payloads small. Fetch full body via get_task_by_id.
  include_instructions: z.boolean().default(false),
  // R3.1: opaque continuation cursor from a prior response's `cursor` field.
  // Resumes the raw candidate scan exactly where that page's window ended.
  cursor: z.string().optional(),
});

// R3.2: internal Firestore page size for the raw-candidate scan, independent
// of the public `limit` (capped at 50 -- R3.5 forbids raising that ceiling
// to fix under-reporting; pagination is the correct fix, not a bigger
// single page). Same rationale as schedule.ts's FALLBACK_PAGE_SIZE.
const CANDIDATE_PAGE_SIZE = 200;

// R3.6: the R3.2 exhaustion scan (below) had no bound. Proving "no work"
// (R3.4) walks the entire raw candidate stream, and that population grows
// monotonically and is never deleted -- relay.ts mirrors every non-RESULT
// message with auto_archived:true, which the default read always rejects,
// plus every expired-TTL carry-forward. The idle-program boot read is the
// fleet's most frequent call, so this is the pathological case, and it was
// getting slower every day. Measured live 2026-08-12 (post-R3.2 deploy):
// totalCandidates:1402 for target:"iso" alone -- exhausting that today costs
// ceil(1402/200)=8 page reads, comfortably inside this budget. At 10x growth
// (~14020 candidates) a full exhaustive scan would cost ~71 page reads; this
// budget caps it at 10, trading a truthful `degraded:true` partial result
// for an ~86% cut in Firestore round trips on the hottest call in the
// fleet. Bounded by PAGE COUNT rather than elapsed time: round-trip count is
// the actual cost driver, and unlike wall-clock it is deterministic and
// directly assertable in tests (see get-tasks-scan-budget.test.ts).
const MAX_CANDIDATE_PAGES = 10;

// R3.6 (time bound): the page-count budget above bounds ROUND-TRIP COUNT,
// which is the normal-case cost driver, but says nothing about wall time if
// individual page reads are slow (Firestore latency spike, cross-region
// jitter). `withTimeout` (dispatchHandler.ts) exists for exactly this and
// deliberately does NOT wrap this handler -- the boot-path read this scan
// serves must degrade gracefully with a resumable cursor, not race a promise
// it cannot safely abandon mid-page (an in-flight Firestore query has no
// partial-result API; wrapping the whole loop in withTimeout would discard
// whatever the current page already read). So the elapsed check lives
// in-loop, checked between page fetches, same shape as the page-count check:
// it can only stop the loop from STARTING another round trip, never abort
// one already in flight. 8s is generous relative to a healthy page read
// (tens to low hundreds of ms) while still well inside typical MCP
// tool-call timeouts, so it only fires under genuine degradation.
const SCAN_TIME_BUDGET_MS = 8_000;

const CreateTaskSchema = z.object({
  title: z.string().max(200),
  instructions: z.string().max(32000).optional(),
  // message_type drives requires_action classification and STATUS/RESULT drain semantics.
  message_type: z.enum(["DIRECTIVE", "QUERY", "HANDSHAKE", "ACK", "STATUS", "PING", "PONG", "RESULT"]).optional(),
  type: z.enum(["task", "question", "dream", "sprint", "sprint-story"]).default("task"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  action: z.enum(["interrupt", "sprint", "parallel", "queue", "backlog"]).default("queue"),
  source: z.string().max(100).optional(),
  target: z.string().max(100),
  projectId: z.string().optional(),
  boardItemId: z.string().optional(),
  // 0 is the never-expires sentinel (see CONSTANTS.ttl.neverExpiresSentinel) and must
  // survive validation — min(0), deliberately not .positive().
  ttl: z.number().int().min(0).max(31536000).optional(),
  replyTo: z.string().optional(),
  threadId: z.string().optional(),
  provenance: z.object({
    model: z.string().optional(),
    cost_tokens: z.number().optional(),
    confidence: z.number().optional(),
  }).optional(),
  fallback: z.array(z.string()).optional(),
  // Agent Trace L1
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

/**
 * Auto-classify whether a task requires action based on source and message_type.
 * Applied at creation time. Rules per council-ratified spec.
 */
function classifyRequiresAction(taskData: Record<string, unknown>): boolean {
  const source = taskData.source as string | undefined;
  const messageType = taskData.message_type as string | undefined;
  const completedStatus = taskData.completed_status as string | undefined;

  // Admin (Flynn) tasks always require action
  if (source === "admin") return true;

  // Classify by message_type
  switch (messageType) {
    case "DIRECTIVE": return true;
    case "QUERY": return true;
    case "HANDSHAKE": return true;
    case "ACK": return false;
    case "STATUS": return false;
    case "PING": return false;
    case "PONG": return false;
    case "RESULT":
      return completedStatus === "FAILED";
    default:
      // Plain tasks (no message_type) require action by default
      return true;
  }
}

export async function getTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetTasksSchema.parse(rawArgs);
  const db = getFirestore();

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`);

  if (args.status !== "all") {
    query = query.where("status", "==", args.status);
  }
  if (args.type !== "all") {
    query = query.where("type", "==", args.type);
  }

  // Target filtering — two modes:
  // (a) Caller named a specific target: query exactly that target. Works for all key types.
  //     This is the fleet supervision path (ISO querying beck's queue, etc.).
  //     NEVER silently fall back to caller scope when a target is specified.
  // (b) No target specified + program key: scope to own tasks + broadcast.
  //     Legacy/mobile/dispatcher keys with no target: see everything.
  // Sprints are org-wide — skip target filter for sprint types.
  if (args.target && args.type !== "sprint" && args.type !== "sprint-story") {
    // Explicit target: filter server-side, no caller-scope fallback
    query = query.where("target", "==", args.target);
  } else if (!args.target && auth.programId !== "legacy" && auth.programId !== "mobile"
      && auth.programId !== "dispatcher" && args.type !== "sprint" && args.type !== "sprint-story") {
    // No target: program keys default to own queue + broadcast
    query = query.where("target", "in", [auth.programId, "all"]);
  }
  // No target + legacy/mobile/dispatcher: no filter (see everything in tenant)

  const orderedQuery = query.orderBy("createdAt", "desc");

  // R3.1/R3.2: resume exactly after the last raw candidate the previous page
  // examined (whether it matched or not).
  let cursorQuery: admin.firestore.Query = orderedQuery;
  if (args.cursor) {
    const cursorDoc = await db.doc(`tenants/${auth.userId}/tasks/${args.cursor}`).get();
    if (!cursorDoc.exists) {
      return jsonResult({ success: false, error: "Invalid or expired cursor" });
    }
    cursorQuery = orderedQuery.startAfter(cursorDoc);
  }

  function passesPostCapFilters(data: admin.firestore.DocumentData): boolean {
    // Filter by requires_action: null = no filter, true/false = exact match
    if (args.requires_action !== null) {
      const reqAction = data.requires_action ?? true; // default true for legacy tasks
      if (reqAction !== args.requires_action) return false;
    }
    // Filter out auto-archived unless explicitly included
    if (!args.include_archived && data.auto_archived === true) return false;
    // Filter out expired tasks (TTL-based auto-archive on read)
    if (data.expiresAt) {
      const expires = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
      if (expires < new Date()) return false;
    }
    return true;
  }

  // R3.2: `limit` must bound MATCHING rows, not raw candidates. Page through
  // the raw candidate stream applying the post-cap predicates above until
  // `limit` matching rows are collected or the stream is genuinely
  // exhausted. R3.3/R3.4: "no work" (hasTasks:false) is reachable only
  // through that exhaustion — never inferred from a single short page.
  const matchedDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  let lastRawDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  let hasMore = false;
  let degraded = false;
  let degradedReason: string | null = null;
  let pagesRead = 0;
  const scanStartMs = Date.now();

  for (;;) {
    pagesRead++;
    const pageSnap = await cursorQuery.limit(CANDIDATE_PAGE_SIZE).get();
    if (pageSnap.docs.length === 0) {
      hasMore = false; // Raw stream exhausted with nothing left at all.
      break;
    }
    for (const doc of pageSnap.docs) {
      lastRawDoc = doc;
      if (passesPostCapFilters(doc.data())) {
        matchedDocs.push(doc);
        if (matchedDocs.length === args.limit) break;
      }
    }
    if (matchedDocs.length === args.limit) {
      // R3.1's one-sided guarantee, preserved under R3.2: peek exactly one
      // more raw candidate beyond the last one examined. hasMore can be a
      // false positive (that candidate turns out not to match) but never a
      // false negative — hasMore:false is reached only via this peek coming
      // back empty, or the stream exhausting outright above/below.
      const peek = await orderedQuery.startAfter(lastRawDoc).limit(1).get();
      hasMore = peek.docs.length > 0;
      break;
    }
    if (pageSnap.docs.length < CANDIDATE_PAGE_SIZE) {
      hasMore = false; // Short page: fewer matches than `limit` exist, period.
      break;
    }
    const elapsedMs = Date.now() - scanStartMs;
    if (pagesRead >= MAX_CANDIDATE_PAGES || elapsedMs >= SCAN_TIME_BUDGET_MS) {
      // R3.6: budget exhausted before the raw stream was. This is NOT
      // exhaustion, so the one-sided guarantee (R3.4) demands hasMore:true
      // here, never false — a bounded scan that reported exhaustion would be
      // defect 3 again, wearing a fix's label. `degraded` distinguishes this
      // "budget hit, unknown how much more" case from the confirmed-via-peek
      // "found `limit` matches, more exist" hasMore:true above, so a caller
      // can tell a truncated read from a complete one. Two independent
      // budgets, either can trip first: page count bounds the normal-case
      // cost, elapsed time bounds a slow-page pathology the count alone
      // can't see (see SCAN_TIME_BUDGET_MS above).
      hasMore = true;
      degraded = true;
      degradedReason = elapsedMs >= SCAN_TIME_BUDGET_MS
        ? `Scan time budget (${SCAN_TIME_BUDGET_MS}ms, ${pagesRead} page(s) of ${CANDIDATE_PAGE_SIZE} read) reached before the raw candidate stream was exhausted; resume with the returned cursor.`
        : `Scan page budget (${MAX_CANDIDATE_PAGES} pages of ${CANDIDATE_PAGE_SIZE}) reached before the raw candidate stream was exhausted; resume with the returned cursor.`;
      break;
    }
    cursorQuery = orderedQuery.startAfter(lastRawDoc);
  }

  const nextCursor = hasMore && lastRawDoc ? lastRawDoc.id : null;

  // Track informational tasks for auto-archive (fire-and-forget)
  const autoArchiveRefs: admin.firestore.DocumentReference[] = [];

  const tasks = matchedDocs
    .map((doc) => {
      const data = doc.data();
      const decrypted = decryptTaskFields(data, auth.encryptionKey);

      // Auto-archive informational tasks on read (fallback for tasks created pre-schema-fix)
      if (data.requires_action === false && !data.auto_archived) {
        autoArchiveRefs.push(doc.ref);
      }

      return {
        id: doc.id,
        type: data.type || "task",
        title: decrypted.title,
        // Omit instruction body by default — callers fetch full body via get_task_by_id on demand.
        // This keeps boot payloads small regardless of pile size.
        instructions: args.include_instructions ? decrypted.instructions : undefined,
        action: data.action || "queue",
        priority: data.priority || "normal",
        status: data.status,
        source: data.source,
        target: data.target,
        projectId: data.projectId || null,
        requires_action: data.requires_action ?? true,
        auto_archived: data.auto_archived || false,
        // Envelope v2.1
        ttl: data.ttl || null,
        replyTo: data.replyTo || null,
        threadId: data.threadId || null,
        provenance: data.provenance || null,
        fallback: data.fallback || null,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        // Completion fields (populated after complete_task)
        result: data.result || null,
        completed_status: data.completed_status || null,
        // R1.3: successor task id, required when completed_status is "PARTIAL"
        successorTaskId: data.successorTaskId || null,
        completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
        claimedBy: data.claimedBy || null,
        claimedAt: data.claimedAt?.toDate?.()?.toISOString() || null,
      };
    });

  // Fire-and-forget: auto-archive informational tasks
  if (autoArchiveRefs.length > 0) {
    const db2 = getFirestore();
    const batch = db2.batch();
    for (const ref of autoArchiveRefs) {
      batch.update(ref, { auto_archived: true, auto_archived_at: admin.firestore.FieldValue.serverTimestamp() });
    }
    batch.commit().catch((err: unknown) => console.error("[AutoArchive] Failed:", err));
  }

  // §4.1: renamed from `total` to `totalCandidates` — it has always measured
  // raw candidates matching the server-side status/type/target filters only
  // (best-effort, "where affordable"), never the matching-row count. Under
  // R3.1 that was internally consistent but the field name didn't say so;
  // R3.2 makes what `limit` bounds explicit throughout, so the rename lands
  // here rather than costing a separate cycle. A count() failure (e.g. a
  // missing index) must not fail the read.
  let totalCandidates: number | null = null;
  try {
    const countSnapshot = await query.count().get();
    totalCandidates = countSnapshot.data().count;
  } catch {
    totalCandidates = null;
  }

  return jsonResult({
    success: true,
    // R3.6 review fix: `degraded` means the scan stopped on a budget
    // cutoff, not on exhaustion -- zero matches found so far is NOT the
    // same claim as R3.4's "verified none". Biasing hasTasks true here
    // preserves the existing boolean contract every current caller's
    // `if (hasTasks)`/`if (!hasTasks)` check already relies on (no fleet-
    // wide migration), at the cost of a caller reading ONLY `hasTasks`
    // being unable to tell "confirmed work" from "budget cut, unconfirmed"
    // apart -- both read true. That residual gap is a deliberate, narrower
    // choice than a tri-state field; see PR discussion for why a tri-state
    // was not picked unilaterally.
    hasTasks: tasks.length > 0 || degraded,
    count: tasks.length,
    tasks,
    // Completeness signal (R3.1, preserved under R3.2): "I have seen
    // everything" is something this response STATES, never inferred from
    // count() alone. `limit` now bounds matching rows (R3.2), so a response
    // under its own limit is reachable only when the read is genuinely
    // complete. This still does not close defect 3's unproven second
    // mechanism (query-vs-point-read divergence) — see PR description.
    hasMore,
    cursor: nextCursor,
    totalCandidates,
    // R3.6: distinguishes a bounded-scan cutoff (unknown how much more, just
    // that the budget ran out) from a confirmed "found `limit` matches, more
    // exist" hasMore:true. Deliberately not named anything that could be
    // confused with hasMore itself.
    degraded,
    degradedReason,
    message: tasks.length > 0
      ? `Found ${tasks.length} task(s)`
      : degraded
        ? "Scan budget reached before any match was found — not verified empty, resume with the returned cursor"
        : "No tasks found",
  });
}

export async function createTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateTaskSchema.parse(rawArgs);

  // Phase 2: Enforce source identity
  const verifiedSource = verifySource(args.source, auth, "mcp");

  // Phase 2: Validate target is a known program or group
  if (args.target !== "all" && !args.target.startsWith("@") && !isGroupTarget(args.target)) {
    const isKnown = await isProgramRegistered(auth.userId, args.target);
    if (!isKnown) {
      return jsonResult({ success: false, error: `Unknown target program: "${args.target}". Use a valid program ID, group name, or @role for role-based targeting.` });
    }
  }

  const db = getFirestore();

  const preview = args.title.length > 50 ? args.title.substring(0, 47) + "..." : args.title;
  const now = serverTimestamp();

  // Resolve the effective ttl once so taskData.ttl and expiresAt can never diverge
  // (same falsy trap as dispatch(): explicit undefined check, not `||` — 0 is the
  // never-expires sentinel and is falsy). type="task" with no explicit ttl keeps
  // the existing 24h default; every other case that previously wrote NO expiresAt
  // field at all now resolves to 0 (never-expires) instead — see W2b.2: an absent
  // expiresAt already meant "never filtered by TTL" to every read path, so this is
  // semantics-preserving, it just stops that field-less-document population from
  // regrowing after W1's backfill.
  const effectiveTtl =
    args.ttl !== undefined ? args.ttl : args.type === "task" ? CONSTANTS.ttl.defaultTaskSeconds : 0;
  const expiresAt =
    effectiveTtl === 0
      ? admin.firestore.Timestamp.fromDate(new Date(CONSTANTS.ttl.neverExpiresSentinel))
      : admin.firestore.Timestamp.fromMillis(Date.now() + effectiveTtl * 1000);

  const taskData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    type: args.type,
    title: args.title,
    instructions: args.instructions || "",
    preview,
    source: verifiedSource,
    target: args.target,
    priority: args.priority,
    action: args.action,
    status: "created",
    projectId: args.projectId || null,
    boardItemId: args.boardItemId || null,
    createdAt: now,
    encrypted: false,
    archived: false,
    // message_type drives classification and drain semantics (STATUS/RESULT).
    message_type: args.message_type || null,
    // Envelope v2.1
    ttl: effectiveTtl,
    replyTo: args.replyTo || null,
    threadId: args.threadId || null,
    provenance: args.provenance || null,
    fallback: args.fallback || null,
    // Agent Trace L1
    traceId: args.traceId || null,
    spanId: args.spanId || generateSpanId(),
    parentSpanId: args.parentSpanId || null,
  };

  // Auto-classification: requires_action
  taskData.requires_action = classifyRequiresAction(taskData);
  taskData.auto_archived = false;

  // Drain semantics for report-type tasks (council-ruled #847/#846):
  // STATUS: informational, latest subsumes prior — never enter `created` pool.
  if (args.message_type === "STATUS" && taskData.requires_action === false) {
    taskData.auto_archived = true;
  }
  // RESULT (non-failed): auto-complete to `done` on create — preserves get_task_lineage/audit
  // history while draining the boot query. Failed RESULTs remain actionable (requires_action:true).
  if (args.message_type === "RESULT" && taskData.requires_action === false) {
    taskData.status = "done";
    taskData.completed_status = "SUCCESS";
    taskData.completedAt = now;
  }

  // Telemetry: classify task
  taskData.task_class = classifyTask(args.type, args.action, args.title);
  taskData.attempt_count = 0;

  taskData.expiresAt = expiresAt;

  const ref = await db.collection(`tenants/${auth.userId}/tasks`).add(taskData);

  // Emit telemetry event
  emitEvent(auth.userId, {
    event_type: "TASK_CREATED",
    program_id: verifiedSource,
    task_id: ref.id,
    task_class: taskData.task_class as TaskClass,
    target: args.target,
    type: args.type,
    priority: args.priority,
    action: args.action,
  });

  // Analytics: task_lifecycle create
  emitAnalyticsEvent(auth.userId, {
    eventType: "task_lifecycle",
    programId: verifiedSource,
    toolName: "create_task",
    taskType: args.type,
    priority: args.priority,
    action: args.action,
    success: true,
  });

  // Fire-and-forget: notify Grid Dispatcher via webhook
  notifyDispatcher({
    taskId: ref.id,
    target: args.target,
    priority: args.priority || 'normal',
    title: args.title,
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget: sync to GitHub Issues + Project board
  syncTaskCreated(
    auth.userId,
    ref.id,
    args.title,
    args.instructions || "",
    args.action,
    args.priority,
    args.projectId,
    args.type,
    args.boardItemId
  );

  // Enrich response with target state (best-effort)
  const baseResult = {
    success: true,
    taskId: ref.id,
    title: args.title,
    action: args.action,
    message: `Task created. ID: "${ref.id}"`,
  };

  try {
    const { queryTargetState } = await import("../wake/onDemandWake.js");
    const targetInfo = await queryTargetState(auth.userId, args.target);
    const enriched: Record<string, unknown> = {
      ...baseResult,
      targetState: targetInfo.targetState,
      heartbeatAge: targetInfo.heartbeatAge,
    };
    if (targetInfo.targetState !== "alive") {
      enriched.warning = `Target "${args.target}" is ${targetInfo.targetState} (heartbeat: ${targetInfo.heartbeatAge}). Task queued but target may not pick it up. Consider using dispatch() for enforced delivery.`;
    }
    return jsonResult(enriched);
  } catch {
    return jsonResult(baseResult);
  }
}

export async function getTaskByIdHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = z.object({ taskId: z.string() }).parse(rawArgs);
  const db = getFirestore();
  const doc = await db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`).get();

  if (!doc.exists) {
    return jsonResult({ success: false, error: "Task not found" });
  }

  const data = doc.data()!;
  const decrypted = decryptTaskFields(data, auth.encryptionKey);

  return jsonResult({
    success: true,
    task: {
      id: doc.id,
      type: data.type || "task",
      title: decrypted.title,
      instructions: decrypted.instructions,
      action: data.action || "queue",
      priority: data.priority || "normal",
      status: data.status,
      source: data.source,
      target: data.target,
      projectId: data.projectId || null,
      requires_action: data.requires_action ?? true,
      auto_archived: data.auto_archived || false,
      ttl: data.ttl || null,
      replyTo: data.replyTo || null,
      threadId: data.threadId || null,
      provenance: data.provenance || null,
      fallback: data.fallback || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      result: data.result || null,
      completed_status: data.completed_status || null,
      // R1.3: successor task id, required when completed_status is "PARTIAL"
      successorTaskId: data.successorTaskId || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
      claimedBy: data.claimedBy || null,
      claimedAt: data.claimedAt?.toDate?.()?.toISOString() || null,
    },
  });
}
