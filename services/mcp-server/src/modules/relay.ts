/**
 * Relay Module — Ephemeral inter-program messages.
 * Collection: tenants/{uid}/relay
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { verifySource } from "../middleware/gate.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { RELAY_DEFAULT_TTL_SECONDS } from "../types/relay.js";
import { resolveTargets, isGroupTarget, PROGRAM_GROUPS } from "../config/programs.js";
import { validatePayload } from "../types/relay-schemas.js";
import { emitEvent } from "./events.js";
import { emitAnalyticsEvent } from "./analytics.js";
import { z } from "zod";

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
  ttl: z.number().positive().optional(),
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
  markAsRead: z.boolean().default(true),
  message_type: z.enum(["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

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

  // Advisory schema validation for structured payload
  let schemaValid: boolean | null = null;
  let structuredPayload: unknown = null;
  if (args.payload) {
    const validation = validatePayload(args.message_type, args.payload);
    schemaValid = validation.valid;
    structuredPayload = args.payload;
    if (!validation.valid) {
      console.warn(`[Relay] Schema validation warning for ${args.message_type}:`, validation.errors);
    }
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

  const ttl = args.ttl || RELAY_DEFAULT_TTL_SECONDS;
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttl * 1000);

  // Resolve target — may be a group (fan-out) or single program
  const targets = resolveTargets(args.target);
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
      });
      refs.push(ref.id);
    }

    // Single task doc for mobile visibility (summary, not fan-out)
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
      priority: args.priority,
      action: args.action,
      status: "created",
      createdAt: serverTimestamp(),
      encrypted: false,
      archived: false,
    });

    await batch.commit();

    // Record idempotency key for multicast
    if (args.idempotency_key) {
      await db.doc(`tenants/${auth.userId}/idempotency_keys/${args.idempotency_key}`).set({
        multicastId,
        recipients: targets.length,
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), // 1 hour TTL
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

  // Emit telemetry event for message delivery
  emitEvent(auth.userId, {
    event_type: "RELAY_DELIVERED",
    program_id: verifiedSource,
    task_id: relayRef.id,
    target: args.target,
    message_type: args.message_type,
    is_multicast: false,
  });

  // Also write to tasks collection for mobile app visibility
  const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
  await db.collection(`tenants/${auth.userId}/tasks`).doc(relayRef.id).set({
    schemaVersion: '2.2' as const,
    type: "task",
    title: `[${verifiedSource}→${args.target}] ${args.message_type}`,
    instructions: args.message,
    preview,
    source: verifiedSource,
    target: args.target,
    priority: args.priority,
    action: args.action,
    status: "created",
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
  });

  // Record idempotency key
  if (args.idempotency_key) {
    await db.doc(`tenants/${auth.userId}/idempotency_keys/${args.idempotency_key}`).set({
      messageId: relayRef.id,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), // 1 hour TTL
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

export async function getMessagesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetMessagesSchema.parse(rawArgs);
  const db = getFirestore();

  let query: admin.firestore.Query = db
    .collection(`tenants/${auth.userId}/relay`)
    .where("status", "==", "pending");

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
    if (auth.programId !== "legacy" && auth.programId !== "mobile") {
      // Program keys: only see messages targeted at this program or broadcast
      return t === auth.programId || t === "all";
    }
    // Legacy/mobile keys: original behavior (filter by requested target)
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
        message: data.payload,
        source: data.source,
        message_type: data.message_type,
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
        if (!fresh.exists || fresh.data()!.status !== "pending") continue;
        const data = fresh.data()!;

        tx.update(ref, {
          status: "delivered",
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          deliveryAttempts: admin.firestore.FieldValue.increment(1),
        });

        claimed.push({
          id,
          message: data.payload,
          source: data.source,
          message_type: data.message_type,
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
  const isPrivileged = ["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId);
  const source = isPrivileged && args.source ? args.source : auth.programId;

  let query: admin.firestore.Query = db
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
  // Admin only (legacy/mobile keys)
  if (auth.programId !== "legacy" && auth.programId !== "mobile" && auth.programId !== "orchestrator") {
    return jsonResult({
      success: false,
      error: "Dead letter queue is only accessible by admin.",
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

  const deadLetters = snapshot.docs.map((doc) => {
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
      dead_letter_reason: data.dead_letter_reason || "EXPIRED_TTL",
      dead_letter_class: data.dead_letter_class || "EXPIRED_TTL",
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      deadLetteredAt: data.deadLetteredAt?.toDate?.()?.toISOString() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    };
  });

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

  // Admin only gate
  if (!["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "query_message_history is only accessible by admin.",
    });
  }

  const db = getFirestore();
  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/relay`);

  if (args.threadId) {
    query = query.where("threadId", "==", args.threadId);
  }
  if (args.source) {
    query = query.where("source", "==", args.source);
  }
  if (args.target) {
    query = query.where("target", "==", args.target);
  }
  if (args.message_type) {
    query = query.where("message_type", "==", args.message_type);
  }
  if (args.status) {
    query = query.where("status", "==", args.status);
  }

  // Sort: ASC when threadId filter set (conversation thread), DESC otherwise
  const sortDirection = args.threadId ? "asc" : "desc";
  query = query.orderBy("createdAt", sortDirection);

  if (args.since) {
    const sinceDate = new Date(args.since);
    query = query.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(sinceDate));
  }
  if (args.until) {
    const untilDate = new Date(args.until);
    query = query.where("createdAt", "<=", admin.firestore.Timestamp.fromDate(untilDate));
  }

  query = query.limit(args.limit);

  const snapshot = await query.get();
  const messages = snapshot.docs.map((doc) => {
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
  const now = admin.firestore.Timestamp.now();

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
      deadLetteredAt: admin.firestore.FieldValue.serverTimestamp(),
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

export async function listGroupsHandler(_auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  const groups: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(PROGRAM_GROUPS)) {
    groups[name] = [...members];
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, groups, message: `${Object.keys(groups).length} groups available` }) }],
  };
}
