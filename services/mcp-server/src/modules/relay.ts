/**
 * Relay Module — Ephemeral inter-program messages.
 * Collection: tenants/{uid}/relay
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { verifySource, logAudit, generateCorrelationId } from "../middleware/gate.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { credentialPrincipal } from "../auth/ownerAuthz.js";
import { RELAY_DEFAULT_TTL_SECONDS } from "../types/relay.js";
import { isGroupTarget, isProgramRegistered, PROGRAM_GROUPS } from "../config/programs.js";
import { resolveTargetsAsync, resolveGroupAsync, listGroupsAsync } from "./programRegistry.js";
import { validatePayload } from "../types/relay-schemas.js";
import { emitEvent } from "./events.js";
import { emitAnalyticsEvent } from "./analytics.js";
import { generateSpanId } from "../utils/trace.js";
import { z } from "zod";
import { logDirective, markDirectiveAcknowledged } from "./ack-compliance.js";
import { getComplianceConfig } from "../config/compliance.js";
import { FieldValue, Timestamp, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { logDenial, denialPrincipal } from "../auth/denialLog.js";
// ADR-014: normalize relay body across split-brain write paths.
// sendMessageHandler writes `payload`; sendTaskAndDirective (dispatchHandler) wrote `message`.
// After dispatchHandler is aligned, this still handles legacy docs in Firestore.
function relayBody(data: Record<string, unknown>): string {
  return (data.payload ?? data.message ?? "") as string;
}

const SendMessageSchema = z.object({
  message: z.string().max(2000),
  source: z.string().max(100),
  target: z.string().max(100),
  message_type: z.enum(["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"]),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  action: z.enum(["interrupt", "sprint", "parallel", "queue", "backlog"]).default("queue"),
  context: z.string().max(500).optional(),
  sessionId: z.string().optional(),
  reply_to: z.string().optional(),
  threadId: z.string().optional(),
  // W2d.2: deliberately NOT z.number().positive() with the generic message -- ttl:0
  // means never-expires elsewhere in this system (dispatch()/create_task, since W2/W2b),
  // but relay expiry is load-bearing here (cleanupExpiredRelayMessages dead-letters
  // expired pending messages; get_messages never surfaces a dead-lettered one again).
  // A relay message that can never dead-letter is undesirable ballast for a target that
  // never claims it, unlike a task, which is meant to persist until someone acts on it.
  // Reject explicitly rather than silently substituting the default -- see the census in
  // PLAN-W2d for the alternative this deliberately avoids.
  ttl: z.number().refine((v) => v > 0, {
    message: "ttl must be a positive number of seconds. ttl:0 (never-expires) is not supported for relay messages -- relay expiry is load-bearing (drives dead-lettering); use dispatch() if you need work that survives indefinitely.",
  }).optional(),
  provenance: z.object({
    model: z.string().optional(),
    cost_tokens: z.number().optional(),
  }).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().max(100).optional(),
  // Agent Trace L1
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const GetMessagesSchema = z.object({
  sessionId: z.string(),
  target: z.string().max(100).optional(),
  // R2.4: default flipped true -- CLAUDE.md's boot protocol and the wake
  // nudge both call this bare, and a bare call is documented as the inbox
  // read. A non-draining read is retained as an explicit opt-out for
  // observer callers (dashboards, fleet monitors, audits) that must not
  // silently claim an inbox they don't own -- see getMessagesHandler for
  // the broadcast exemption that keeps the drain safe for multi-recipient
  // messages regardless of this default.
  markAsRead: z.boolean().default(true),
  includeDelivered: z.boolean().default(false),
  message_type: z.enum(["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

/** Principals that keep the requested-target inbox read (RD-5 PR-K, amendment 3 rule 1: `legacy` is dropped). */
const RELAY_READ_ALL_PRINCIPALS = ["mobile", "dispatcher"] as const;
/** Principals that read any program's sent messages and message history (K-D3 option 1). */
const RELAY_ADMIN_PRINCIPALS = ["mobile", "dispatcher"] as const;
const inList = (list: readonly string[], name: string): boolean => list.includes(name);

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, normal: 1, low: 2 };

function sortByPriorityThenDate(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority as string] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority as string] ?? 1;
    if (pa !== pb) return pa - pb;
    // Newest first within same priority
    const da = a.createdAt as string || "";
    const db_date = b.createdAt as string || "";
    return db_date.localeCompare(da);
  });
}

export async function sendMessageHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SendMessageSchema.parse(rawArgs);

  // W1.2.4: Idempotency key enforcement
  const complianceConfigIdempotency = getComplianceConfig(auth.userId);
  if (!args.idempotency_key) {
    if (complianceConfigIdempotency.idempotencyKey.enforcement === "required") {
      return jsonResult({
        success: false,
        error: "idempotency_key is required for send_message to prevent duplicate messages.",
      });
    } else if (complianceConfigIdempotency.idempotencyKey.enforcement === "recommended") {
      console.warn(`[W1.2.4] send_message called without idempotency_key by ${auth.keyProgramId}. This may result in duplicate messages on retry.`);
    }
  }

  // Schema validation for structured payload (enforced)
  let schemaValid: boolean | null = null;
  let structuredPayload: unknown = null;
  if (args.payload) {
    const validation = validatePayload(args.message_type, args.payload);
    schemaValid = validation.valid;
    structuredPayload = args.payload;
    if (!validation.valid) {
      return jsonResult({
        success: false,
        error: `Schema validation failed for ${args.message_type}`,
        details: validation.errors,
      });
    }
  }

  // Advisory warning: STATUS messages between programs should use update_program_state
  if (args.message_type === "STATUS" && args.target !== "user" && args.target !== "admin") {
    console.warn(
      `[Comms Pattern] ${args.source}→${args.target} STATUS via relay. ` +
      `Consider update_program_state(contextSummary) instead. See ADR adr-comms-pattern.`
    );
  }

  // Phase 2: Enforce source identity
  const verifiedSource = verifySource(args.source, auth, "mcp");
  const db = getFirestore();

  // Idempotency check
  if (args.idempotency_key) {
    const idempotencyRef = db.doc(`tenants/${auth.userId}/idempotency_keys/${args.idempotency_key}`);
    const existing = await idempotencyRef.get();
    if (existing.exists) {
      const data = existing.data()!;
      // Check if not expired (1-hour TTL)
      const expiresAt = data.expiresAt?.toMillis?.() || 0;
      if (expiresAt > Date.now()) {
        // Full short-circuit: return cached result
        return jsonResult({
          success: true,
          messageId: data.messageId || undefined,
          multicastId: data.multicastId || undefined,
          action: args.action,
          relay: true,
          idempotent: true,
          message: `Idempotent: message already sent. ID: "${data.messageId || data.multicastId}"`,
        });
      }
    }
  }

  // `||` is safe here specifically because SendMessageSchema's ttl refine already
  // rejects 0 (and negatives) before this line runs -- args.ttl is either undefined
  // or a genuine positive number, never the never-expires sentinel value.
  const ttl = args.ttl || RELAY_DEFAULT_TTL_SECONDS;
  const expiresAt = Timestamp.fromMillis(Date.now() + ttl * 1000);

  // Resolve target — may be a group (fan-out) or single program
  let targets = await resolveTargetsAsync(auth.userId, args.target);

  // Validate target reachability — reject unknown/non-local targets (false-success guard).
  // If the target wasn't resolved by the hardcoded group list or @role prefix, it came
  // back as-is. Check Firestore-only groups first (e.g. grid-help), then program registry.
  // Note: use rawTarget string to avoid isGroupTarget's type guard narrowing to never.
  const rawTarget: string = args.target;
  if (!(rawTarget in PROGRAM_GROUPS) && !rawTarget.startsWith("@") && targets.length === 1 && targets[0] === rawTarget) {
    const dynamicGroupMembers = await resolveGroupAsync(auth.userId, rawTarget);
    if (dynamicGroupMembers.length > 0) {
      // Dynamic group (Firestore-only, e.g. "grid-help") — fan out to members
      targets = dynamicGroupMembers;
    } else {
      // Not a group — must be a registered program or a known special relay target
      // "slack-bridge" is consumed by functions/onSlackBridge, which posts to #grid-ops.
      const RELAY_SPECIAL_TARGETS = new Set(["user", "admin", "slack-bridge"]);
      if (!RELAY_SPECIAL_TARGETS.has(rawTarget)) {
        const registered = await isProgramRegistered(auth.userId, rawTarget);
        if (!registered) {
          return jsonResult({
            success: false,
            error: `Unknown relay target "${rawTarget}". Target must be a registered program, group, or role. Message not sent.`,
          });
        }
      }
    }
  }

  // Grid-help tenant routing: when a message targets the grid-help group and the
  // sender supplies payload.tenant, also deliver to vector_<tenant> — the orchestrator
  // that owns that tenant and acts on the help request. The group members (vector,
  // tensor, scalar) always receive it too; the extra delivery is tenant-specific.
  //
  // Tenant isolation: only vector_<tenant> is added — other vector_* programs never
  // see requests for a different tenant.
  //
  // message_type decision (item 3): routing is triggered by rawTarget === "grid-help",
  // NOT by message_type. The bridge may use STATUS, ALERT, DIRECTIVE — all are treated
  // equally. No dedicated help message_type is needed; the group target is the discriminator.
  let tenantOwnerToWake: string | null = null;
  if (rawTarget === "grid-help" && args.payload?.tenant) {
    const tenantOwner = `vector_${String(args.payload.tenant)}`;
    const isTenantOwnerRegistered = await isProgramRegistered(auth.userId, tenantOwner);
    if (isTenantOwnerRegistered && !targets.includes(tenantOwner)) {
      targets = [...targets, tenantOwner];
      tenantOwnerToWake = tenantOwner;
    }
  }

  const isMulticast = targets.length > 1;
  const multicastId = isMulticast ? db.collection("_").doc().id : undefined;

  const baseData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    source: verifiedSource,
    message_type: args.message_type,
    payload: args.message,
    priority: args.priority,
    action: args.action,
    context: args.context || null,
    sessionId: args.sessionId || null,
    reply_to: args.reply_to || null,
    threadId: args.threadId || null,
    status: "pending",
    ttl,
    expiresAt,
    deliveryAttempts: 0,
    maxDeliveryAttempts: 3,
    provenance: args.provenance || null,
    structuredPayload: structuredPayload,
    schemaValid: schemaValid,
    // Agent Trace L1
    traceId: args.traceId || null,
    spanId: args.spanId || generateSpanId(),
    parentSpanId: args.parentSpanId || null,
    createdAt: serverTimestamp(),
  };

  if (isMulticast) {
    // Fan out: one relay doc per target
    const batch = db.batch();
    const refs: string[] = [];

    for (const target of targets) {
      const ref = db.collection(`tenants/${auth.userId}/relay`).doc();
      batch.set(ref, {
        ...baseData,
        target,
        multicastId,
        multicastSource: args.target,
        // Agent Trace L1: each fan-out message gets unique spanId
        spanId: generateSpanId(),
      });
      refs.push(ref.id);
    }

    // Single task doc for mobile visibility (summary, not fan-out).
    // ADR-014: RESULT mirrors are claimable (requires_action:true); all other
    // types are informational (auto_archived, invisible to default task polls).
    const isResultMirror = args.message_type === "RESULT";
    const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
    const taskRef = db.collection(`tenants/${auth.userId}/tasks`).doc();
    batch.set(taskRef, {
      schemaVersion: '2.2' as const,
      type: "task",
      title: `[${verifiedSource}→${args.target}] ${args.message_type}`,
      instructions: args.message,
      preview,
      source: verifiedSource,
      target: args.target,
      message_type: args.message_type,
      priority: args.priority,
      action: args.action,
      status: "created",
      requires_action: isResultMirror,
      ...(isResultMirror ? {} : { auto_archived: true }),
      relay_mirror: true,
      created_via: { tool: "relay_mirror" },
      ttl,
      expiresAt,
      createdAt: serverTimestamp(),
      encrypted: false,
      archived: false,
    });

    await batch.commit();

    // Wake tenant owner after delivery (fire-and-forget — don't block the send response)
    if (tenantOwnerToWake) {
      const tenantOwnerCapture = tenantOwnerToWake;
      import("./wake/onDemandWake.js").then(({ wakeTarget }) =>
        wakeTarget({ userId: auth.userId, target: tenantOwnerCapture, waitForAlive: false, callerSource: args.source })
      ).catch((err) => console.warn(`[grid-help] wake ${tenantOwnerCapture}:`, err));
    }

    // Record idempotency key for multicast
    if (args.idempotency_key) {
      await db.doc(`tenants/${auth.userId}/idempotency_keys/${args.idempotency_key}`).set({
        multicastId,
        recipients: targets.length,
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), // 1 hour TTL
        createdAt: serverTimestamp(),
      });
    }

    // Emit telemetry event for multicast delivery
    emitEvent(auth.userId, {
      event_type: "RELAY_DELIVERED",
      program_id: verifiedSource,
      task_id: multicastId,
      target: args.target,
      message_type: args.message_type,
      is_multicast: true,
    });

    // Analytics: message_lifecycle send (multicast)
    emitAnalyticsEvent(auth.userId, {
      eventType: "message_lifecycle",
      programId: verifiedSource,
      toolName: "send_message",
      messageType: args.message_type,
      priority: args.priority,
      action: args.action,
      success: true,
    });

    return jsonResult({
      success: true,
      multicastId,
      recipients: targets.length,
      targets,
      action: args.action,
      relay: true,
      message: `Multicast sent to ${targets.length} recipients (${args.target}). ID: "${multicastId}"`,
    });
  }

  // Single target — original behavior
  const relayData = {
    ...baseData,
    target: args.target,
  };

  const relayRef = await db.collection(`tenants/${auth.userId}/relay`).add(relayData);

  // W1.2.3: Log DIRECTIVE messages to audit trail
  const complianceConfigAudit = getComplianceConfig(auth.userId);
  if (args.message_type === "DIRECTIVE" && complianceConfigAudit.ackAudit.enabled) {
    await logDirective(
      auth.userId,
      relayRef.id,
      verifiedSource,
      args.target,
      args.message,
      args.threadId,
      args.sessionId
    );
  }

  // W1.2.3: Mark DIRECTIVE as acknowledged when ACK received
  if (args.message_type === "ACK" && args.reply_to && complianceConfigAudit.ackAudit.enabled) {
    try {
      await markDirectiveAcknowledged(auth.userId, args.reply_to, relayRef.id);
    } catch (error) {
      // Log error but don't fail the ACK send
      console.warn(`[W1.2.3] Failed to mark DIRECTIVE ${args.reply_to} as acknowledged:`, error);
    }
  }

  // Emit telemetry event for message delivery
  emitEvent(auth.userId, {
    event_type: "RELAY_DELIVERED",
    program_id: verifiedSource,
    task_id: relayRef.id,
    target: args.target,
    message_type: args.message_type,
    is_multicast: false,
  });

  // Also write to tasks collection for mobile app visibility.
  // ADR-014: RESULT mirrors are claimable (requires_action:true); all other
  // types are informational (auto_archived, invisible to default task polls).
  const isResultMirror = args.message_type === "RESULT";
  const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
  await db.collection(`tenants/${auth.userId}/tasks`).doc(relayRef.id).set({
    schemaVersion: '2.2' as const,
    type: "task",
    title: `[${verifiedSource}→${args.target}] ${args.message_type}`,
    instructions: args.message,
    preview,
    source: verifiedSource,
    target: args.target,
    message_type: args.message_type,
    priority: args.priority,
    action: args.action,
    status: "created",
    requires_action: isResultMirror,
    ...(isResultMirror ? {} : { auto_archived: true }),
    relay_mirror: true,
    created_via: { tool: "relay_mirror" },
    ttl,
    expiresAt,
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
  });

  // Record idempotency key
  if (args.idempotency_key) {
    await db.doc(`tenants/${auth.userId}/idempotency_keys/${args.idempotency_key}`).set({
      messageId: relayRef.id,
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), // 1 hour TTL
      createdAt: serverTimestamp(),
    });
  }

  // Analytics: message_lifecycle send
  emitAnalyticsEvent(auth.userId, {
    eventType: "message_lifecycle",
    programId: verifiedSource,
    toolName: "send_message",
    messageType: args.message_type,
    priority: args.priority,
    action: args.action,
    success: true,
  });

  return jsonResult({
    success: true,
    messageId: relayRef.id,
    action: args.action,
    relay: true,
    schemaValid,
    message: `Message sent. ID: "${relayRef.id}"`,
  });
}

/**
 * R6 / K-D2 option 2. The subject of an inbox read is the explicit target, or a sessionId that names another
 * registered program. A session label that names no program is not a subject. Self and the broadcast target are
 * always allowed; RELAY_READ_ALL_PRINCIPALS may read any inbox. Bound to credentialPrincipal.
 */
async function authorizeRelayRead(
  auth: AuthContext, target: string | undefined, sessionId: string
): Promise<{ allowed: boolean; readsAll: boolean; subject: string | undefined }> {
  const principal = credentialPrincipal(auth);
  const readsAll = inList(RELAY_READ_ALL_PRINCIPALS, principal);
  if (readsAll) return { allowed: true, readsAll, subject: target };
  const subject = target ?? (sessionId !== principal && (await isProgramRegistered(auth.userId, sessionId)) ? sessionId : undefined);
  const allowed = !subject || subject === principal || subject === "all";
  return { allowed, readsAll, subject };
}

export async function getMessagesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetMessagesSchema.parse(rawArgs);
  const db = getFirestore();
  const principal = credentialPrincipal(auth);

  // R6, K-D2 option 2: a restricted key reads only its own inbox (plus broadcasts). The denial fires before
  // query.get(), so nothing is read or claimed.
  const { allowed, readsAll, subject } = await authorizeRelayRead(auth, args.target, args.sessionId);
  if (!allowed) {
    logDenial({ principal: denialPrincipal(auth), tool: "relay_get_messages", subject: subject ?? null, code: "FOREIGN_SUBJECT" });
    return jsonResult({
      success: false,
      error: `Access denied: "${principal}" cannot read messages for "${subject}"`,
    });
  }

  // ADR-013: includeDelivered re-opens the body-read window after a claim.
  // Target enforcement below scopes it; the claim transaction skips
  // non-pending docs, so delivered re-reads can never re-claim.
  let query: Query = db.collection(`tenants/${auth.userId}/relay`);
  query = args.includeDelivered
    ? query.where("status", "in", ["pending", "delivered"])
    : query.where("status", "==", "pending");

  if (args.message_type) {
    query = query.where("message_type", "==", args.message_type);
  }
  if (args.priority) {
    query = query.where("priority", "==", args.priority);
  }

  query = query.orderBy("createdAt", "asc");

  const snapshot = await query.get();

  // Phase 2: Target enforcement — programs only see their own messages
  const requestedTarget = args.target || args.sessionId;
  const filtered = snapshot.docs.filter((doc) => {
    const t = doc.data().target;
    if (!readsAll) {
      // Program keys: only see messages targeted at this program or broadcast
      return t === principal || t === "all";
    }
    // mobile and dispatcher keys: filter by the requested target
    return !t || t === requestedTarget || t === "all";
  });

  if (filtered.length === 0) {
    return jsonResult({
      success: true,
      hasInterrupts: false,
      interrupts: [],
      message: "No pending messages",
    });
  }

  if (!args.markAsRead) {
    const messages = filtered.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        message: relayBody(data),
        source: data.source,
        message_type: data.message_type,
        status: data.status,
        action: data.action,
        priority: data.priority,
        context: data.context || null,
        reply_to: data.reply_to || null,
        threadId: data.threadId || null,
        ttl: data.ttl || null,
        provenance: data.provenance || null,
        multicastId: data.multicastId || null,
        multicastSource: data.multicastSource || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
    sortByPriorityThenDate(messages);
    return jsonResult({
      success: true,
      hasInterrupts: true,
      interrupts: messages,
      message: `${messages.length} message(s)`,
    });
  }

  // Atomic claim via transaction
  try {
    const result = await db.runTransaction(async (tx) => {
      const claimed: Array<Record<string, unknown>> = [];
      const freshDocs = await Promise.all(filtered.map(async (doc) => ({
        ref: doc.ref,
        id: doc.id,
        fresh: await tx.get(doc.ref),
      })));

      for (const { ref, id, fresh } of freshDocs) {
        if (!fresh.exists) continue;
        const data = fresh.data()!;
        // R2.4: a broadcast (target:"all") is ONE relay doc read by every
        // recipient -- there is no per-recipient delivery state in this
        // schema. Marking it "delivered" on the first claim would make that
        // reader silently swallow it for every other program the broadcast
        // targeted, since the next reader's default query only sees
        // status:"pending". Broadcasts are therefore exempt from the claim
        // mutation entirely (never transition, deliveryAttempts never
        // increments) and are always returned read-only, regardless of
        // markAsRead. This is the same drain-is-safe reasoning as direct
        // messages, applied to the one case where a single doc has more
        // than one true recipient.
        const isBroadcast = data.target === "all";

        if (data.status === "pending" && !isBroadcast) {
          tx.update(ref, {
            status: "delivered",
            deliveredAt: FieldValue.serverTimestamp(),
            deliveryAttempts: FieldValue.increment(1),
          });
        } else if (data.status === "pending" && isBroadcast) {
          // Return it, but never mutate it or count it as a delivery attempt.
        } else if (!(args.includeDelivered && data.status === "delivered")) {
          // Only pending docs are claimable; delivered docs are returned
          // read-only when includeDelivered is set, all others skipped.
          continue;
        }

        claimed.push({
          id,
          message: relayBody(data),
          source: data.source,
          message_type: data.message_type,
          status: (data.status === "pending" && !isBroadcast) ? "delivered" : data.status,
          action: data.action,
          priority: data.priority,
          context: data.context || null,
          reply_to: data.reply_to || null,
          threadId: data.threadId || null,
          ttl: data.ttl || null,
          provenance: data.provenance || null,
          multicastId: data.multicastId || null,
          multicastSource: data.multicastSource || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        });
      }
      return claimed;
    });

    return jsonResult({
      success: true,
      hasInterrupts: result.length > 0,
      interrupts: sortByPriorityThenDate(result),
      message: result.length > 0 ? `${result.length} interrupt(s) from user` : "No pending interrupts",
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to claim messages: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * RD-5 PR-M row 2 (M-D1): POST /v1/messages/mark_read. Per id: the message's target is the principal, or the principal is in
 * RELAY_READ_ALL_PRINCIPALS (mobile, dispatcher). A broadcast (target "all") is one doc shared by every reader, so it never
 * changes state for anyone (R6a). A missing id is counted as notFound and is not a denial. Each refused id writes one logDenial.
 */
export async function markReadHandler(
  auth: AuthContext, messageIds: string[]
): Promise<{ updated: number; notFound: number; broadcast: number; denied: Array<{ id: string; error: string }> }> {
  const principal = credentialPrincipal(auth);
  const readsAll = inList(RELAY_READ_ALL_PRINCIPALS, principal);
  const db = getFirestore();
  const ids = [...new Set(messageIds.slice(0, 100))];
  const refs = ids.map((id) => db.doc(`tenants/${auth.userId}/relay/${id}`));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  const out = { updated: 0, notFound: 0, broadcast: 0, denied: [] as Array<{ id: string; error: string }> };
  snaps.forEach((snap, i) => {
    if (!snap.exists) { out.notFound++; return; }
    const target = snap.data()?.target;
    if (target === "all") { out.broadcast++; return; }
    if (target === principal || readsAll) {
      batch.update(refs[i], { status: "read", readAt: FieldValue.serverTimestamp() });
      out.updated++;
      return;
    }
    logDenial({ principal: denialPrincipal(auth), tool: "relay_mark_read", subject: typeof target === "string" ? target : null, code: "FOREIGN_SUBJECT" });
    out.denied.push({ id: ids[i], error: `Access denied: "${principal}" cannot mark read message "${ids[i]}"` });
  });
  if (out.updated > 0) await batch.commit();
  return out;
}

const GetDeadLettersSchema = z.object({
  limit: z.number().min(1).max(50).default(20),
});

const GetSentMessagesSchema = z.object({
  status: z.string().optional(),
  target: z.string().max(100).optional(),
  threadId: z.string().optional(),
  source: z.string().max(100).optional(),
  limit: z.number().min(1).max(50).default(20),
});

export async function getSentMessagesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetSentMessagesSchema.parse(rawArgs);
  const db = getFirestore();

  // Programs see own sent only; admin can pass optional source to see any
  const principal = credentialPrincipal(auth);
  const source = args.source ?? principal;
  if (source !== principal && !inList(RELAY_ADMIN_PRINCIPALS, principal)) {
    logDenial({ principal: denialPrincipal(auth), tool: "relay_get_sent_messages", subject: source, code: "FOREIGN_SUBJECT" });
    return jsonResult({
      success: false,
      error: `Access denied: "${principal}" cannot read sent messages for "${source}"`,
    });
  }

  let query: Query = db
    .collection(`tenants/${auth.userId}/relay`)
    .where("source", "==", source);

  if (args.status) {
    query = query.where("status", "==", args.status);
  }
  if (args.target) {
    query = query.where("target", "==", args.target);
  }
  if (args.threadId) {
    query = query.where("threadId", "==", args.threadId);
  }

  query = query.orderBy("createdAt", "desc").limit(args.limit);

  const snapshot = await query.get();
  const messages = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      target: data.target,
      message_type: data.message_type,
      // ADR-013: a sender re-reading their own body is zero new exposure
      message: data.payload,
      status: data.status,
      deliveryAttempts: data.deliveryAttempts || 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    };
  });

  return jsonResult({
    success: true,
    count: messages.length,
    source,
    messages,
  });
}

export async function getDeadLettersHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin only (RD-5 PR-L row 30, K-D3): RELAY_ADMIN_PRINCIPALS on credentialPrincipal. Dead letters carry message bodies.
  const principal = credentialPrincipal(auth);
  if (!inList(RELAY_ADMIN_PRINCIPALS, principal)) {
    logDenial({ principal, tool: "relay_get_dead_letters", subject: null, code: "NOT_GRANTED" });
    return jsonResult({
      success: false,
      error: `Access denied: "${principal}" cannot read dead letters (the dead letter queue is only accessible by admin principals).`,
    });
  }

  const args = GetDeadLettersSchema.parse(rawArgs);
  const db = getFirestore();

  const snapshot = await db
    .collection(`tenants/${auth.userId}/relay`)
    .where("status", "==", "dead_lettered")
    .orderBy("deadLetteredAt", "desc")
    .limit(args.limit)
    .get();

  // Legacy: until 2026-10 processDeadLetters COPIED unread messages to
  // tenants/{uid}/dead_letters (status "dead_letter") and DELETED them from
  // relay, so those messages are only here. Read them too, flagged legacy, so
  // get_dead_letters shows what that function removed (K0NF26vX).
  const legacySnapshot = await db
    .collection(`tenants/${auth.userId}/dead_letters`)
    .orderBy("deadLetteredAt", "desc")
    .limit(args.limit)
    .get();

  const toRow = (doc: QueryDocumentSnapshot, legacy: boolean) => {
    const data = doc.data();
    return {
      id: doc.id,
      source: data.source,
      target: data.target,
      message_type: data.message_type,
      payload: data.payload,
      priority: data.priority,
      action: data.action,
      context: data.context || null,
      deliveryAttempts: data.deliveryAttempts || 0,
      maxDeliveryAttempts: data.maxDeliveryAttempts || 3,
      dead_letter_reason: data.dead_letter_reason || (legacy ? "UNREAD_AFTER_1H_LEGACY" : "EXPIRED_TTL"),
      dead_letter_class: data.dead_letter_class || (legacy ? "UNREAD_AFTER_1H_LEGACY" : "EXPIRED_TTL"),
      legacy,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      deadLetteredAt: data.deadLetteredAt?.toDate?.()?.toISOString() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    };
  };

  const deadLetters = [
    ...snapshot.docs.map((doc) => toRow(doc, false)),
    ...legacySnapshot.docs.map((doc) => toRow(doc, true)),
  ]
    .sort((a, b) => (b.deadLetteredAt || "").localeCompare(a.deadLetteredAt || ""))
    .slice(0, args.limit);

  return jsonResult({
    success: true,
    count: deadLetters.length,
    deadLetters,
    message: deadLetters.length > 0
      ? `Found ${deadLetters.length} dead letter(s)`
      : "No dead letters found",
  });
}

const QueryMessageHistorySchema = z.object({
  threadId: z.string().optional(),
  source: z.string().max(100).optional(),
  target: z.string().max(100).optional(),
  message_type: z.enum(["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"]).optional(),
  status: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export async function queryMessageHistoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = QueryMessageHistorySchema.parse(rawArgs);

  // Require at least 1 filter
  if (!args.threadId && !args.source && !args.target) {
    return jsonResult({
      success: false,
      error: "At least one of threadId, source, or target is required.",
    });
  }

  // ADR-013: participant scoping for non-admins. The read path has no
  // verifiedSource equivalent — this coercion IS the entire gate (SARK C1).
  // Caller-supplied identity args naming another program are rejected,
  // never passed through to the query.
  const principal = credentialPrincipal(auth);
  const privileged = inList(RELAY_ADMIN_PRINCIPALS, principal);
  if (!privileged) {
    const self = principal;
    if (args.source && args.source !== self) {
      logDenial({ principal: denialPrincipal(auth), tool: "relay_query_message_history", subject: args.source ?? null, code: "FOREIGN_SUBJECT" });
      return jsonResult({
        success: false,
        error: `Participant scope: non-admin callers may only query source "${self}".`,
      });
    }
    if (args.target && args.target !== self && args.target !== "all") {
      logDenial({ principal: denialPrincipal(auth), tool: "relay_query_message_history", subject: args.target ?? null, code: "FOREIGN_SUBJECT" });
      return jsonResult({
        success: false,
        error: `Participant scope: non-admin callers may only query target "${self}" or "all".`,
      });
    }
  }

  const db = getFirestore();
  const collection = db.collection(`tenants/${auth.userId}/relay`);

  // Sort: ASC when threadId filter set (conversation thread), DESC otherwise
  const sortDirection: "asc" | "desc" = args.threadId ? "asc" : "desc";

  const applyCommonFilters = (q: Query): Query => {
    if (args.threadId) {
      q = q.where("threadId", "==", args.threadId);
    }
    if (args.message_type) {
      q = q.where("message_type", "==", args.message_type);
    }
    if (args.status) {
      q = q.where("status", "==", args.status);
    }
    q = q.orderBy("createdAt", sortDirection);
    if (args.since) {
      q = q.where("createdAt", ">=", Timestamp.fromDate(new Date(args.since)));
    }
    if (args.until) {
      q = q.where("createdAt", "<=", Timestamp.fromDate(new Date(args.until)));
    }
    return q.limit(args.limit);
  };

  let queries: Query[];
  if (privileged || args.source || args.target) {
    // Admin: filters as given. Non-admin: source/target already coerced to
    // self/"all" above, so a single filtered query is participant-scoped.
    let q: Query = collection;
    if (args.source) {
      q = q.where("source", "==", args.source);
    }
    if (args.target) {
      q = q.where("target", "==", args.target);
    }
    queries = [applyCommonFilters(q)];
  } else {
    // Non-admin threadId-only query: the participant constraint is forcibly
    // added (SARK C3 LOCK) — both directions plus broadcast, merged in-handler.
    const self = principal;
    queries = [
      applyCommonFilters(collection.where("source", "==", self)),
      applyCommonFilters(collection.where("target", "==", self)),
      applyCommonFilters(collection.where("target", "==", "all")),
    ];
  }

  const snapshots = await Promise.all(queries.map((q) => q.get()));
  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      byId.set(doc.id, doc);
    }
  }

  const docs = [...byId.values()]
    .sort((a, b) => {
      const ta = a.data().createdAt?.toMillis?.() ?? 0;
      const tb = b.data().createdAt?.toMillis?.() ?? 0;
      return sortDirection === "asc" ? ta - tb : tb - ta;
    })
    .slice(0, args.limit);

  const messages = docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      source: data.source,
      target: data.target,
      message_type: data.message_type,
      message: data.payload,
      status: data.status,
      priority: data.priority,
      action: data.action,
      context: data.context || null,
      threadId: data.threadId || null,
      reply_to: data.reply_to || null,
      deliveryAttempts: data.deliveryAttempts || 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    };
  });

  // ADR-013 read-audit (SARK C4, GO condition): ledger the effective filters,
  // result count, and returned message IDs so "who read what" is answerable.
  logAudit({
    timestamp: new Date().toISOString(),
    correlationId: generateCorrelationId(),
    tool: "relay_query_message_history.read",
    source: principal,
    programId: principal,
    userId: auth.userId,
    endpoint: "handler",
    allowed: true,
    details: {
      effectiveFilters: {
        threadId: args.threadId ?? null,
        source: args.source ?? null,
        target: args.target ?? null,
        message_type: args.message_type ?? null,
        status: args.status ?? null,
        since: args.since ?? null,
        until: args.until ?? null,
        limit: args.limit,
        participantScope: privileged ? null : principal,
      },
      resultCount: messages.length,
      messageIds: messages.map((m) => m.id),
    },
  });

  return jsonResult({
    success: true,
    count: messages.length,
    sort: sortDirection,
    messages,
  });
}

/**
 * Classify dead letter reason based on message data.
 * Used for structured dead letter analytics.
 */
function classifyDeadLetter(data: Record<string, unknown>): string {
  // If delivery was attempted but failed
  const attempts = (data.deliveryAttempts as number) || 0;
  const maxAttempts = (data.maxDeliveryAttempts as number) || 3;
  
  if (attempts >= maxAttempts) {
    return "MAX_ATTEMPTS_EXCEEDED";
  }
  
  // Default for TTL cleanup is EXPIRED_TTL
  return "EXPIRED_TTL";
}

export async function cleanupExpiredRelayMessages(userId: string): Promise<{ expired: number; cleaned: number }> {
  const db = getFirestore();
  const now = Timestamp.now();

  const snapshot = await db
    .collection(`tenants/${userId}/relay`)
    .where("status", "==", "pending")
    .where("expiresAt", "<=", now)
    .limit(100)
    .get();

  const expired = snapshot.size;
  if (snapshot.empty) return { expired: 0, cleaned: 0 };

  const batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Update in-place with dead_lettered status
    batch.update(doc.ref, {
      status: "dead_lettered",
      reason: "TTL expired",           // keep for backwards compat
      dead_letter_reason: "EXPIRED_TTL" as const,  // new structured field
      dead_letter_class: classifyDeadLetter(data),  // add classification
      deadLetteredAt: FieldValue.serverTimestamp(),
    });
    count++;
  }

  await batch.commit();

  // Emit telemetry event for dead lettering
  emitEvent(userId, {
    event_type: "RELAY_DEAD_LETTERED",
    dead_letter_count: count,
    dead_letter_reason: "EXPIRED_TTL",
  });

  return { expired, cleaned: count };
}

export async function sendDirectiveHandler(auth: AuthContext, args: unknown): Promise<ToolResult> {
  const schema = z.object({
    source: z.string().max(100),
    target: z.string().max(100),
    message: z.string().max(2000),
    priority: z.enum(["low", "normal", "high"]).default("high"),
    threadId: z.string().optional(),
  });
  const parsed = schema.parse(args);

  const result = await sendMessageHandler(auth, {
    ...parsed,
    message_type: "DIRECTIVE",
    action: "interrupt",
  });

  // Enrich response with target state (soft warning, backwards compatible)
  try {
    const { queryTargetState } = await import("./wake/onDemandWake.js");
    const targetInfo = await queryTargetState(auth.userId, parsed.target);
    const resultData = JSON.parse(result.content[0].text);
    resultData.targetState = targetInfo.targetState;
    resultData.heartbeatAge = targetInfo.heartbeatAge;
    if (targetInfo.targetState !== "alive") {
      resultData.warning = `Target "${parsed.target}" is ${targetInfo.targetState} (heartbeat: ${targetInfo.heartbeatAge}). Directive stored but may not be received. Consider using dispatch() for enforced delivery.`;
    }
    return jsonResult(resultData);
  } catch {
    // Enrichment is best-effort — return original result on any failure
    return result;
  }
}

export async function listGroupsHandler(auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  const groups = await listGroupsAsync(auth.userId);
  return {
    content: [{ type: "text", text: JSON.stringify({
      success: true,
      groups,
      roleTargeting: "Use @role prefix (e.g., @builder) to target all programs with that role",
      message: `${Object.keys(groups).length} groups available`
    }) }],
  };
}
