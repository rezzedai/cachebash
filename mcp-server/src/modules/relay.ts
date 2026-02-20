/**
 * Relay Module — Ephemeral inter-program messages.
 * Collection: users/{uid}/relay
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { verifySource } from "../middleware/gate.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { RELAY_DEFAULT_TTL_SECONDS } from "../types/relay.js";
import { resolveTargets, isGroupTarget, PROGRAM_GROUPS } from "../config/programs.js";
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

  // Phase 2: Enforce source identity
  const verifiedSource = verifySource(args.source, auth, "mcp");
  const db = getFirestore();

  const ttl = args.ttl || RELAY_DEFAULT_TTL_SECONDS;
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttl * 1000);

  // Resolve target — may be a group (fan-out) or single program
  const targets = resolveTargets(args.target);
  const isMulticast = targets.length > 1;
  const multicastId = isMulticast ? db.collection("_").doc().id : undefined;

  const baseData: Record<string, unknown> = {
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
    createdAt: serverTimestamp(),
  };

  if (isMulticast) {
    // Fan out: one relay doc per target
    const batch = db.batch();
    const refs: string[] = [];

    for (const target of targets) {
      const ref = db.collection(`users/${auth.userId}/relay`).doc();
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
    const taskRef = db.collection(`users/${auth.userId}/tasks`).doc();
    batch.set(taskRef, {
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

  const relayRef = await db.collection(`users/${auth.userId}/relay`).add(relayData);

  // Also write to tasks collection for mobile app visibility
  const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
  await db.collection(`users/${auth.userId}/tasks`).doc(relayRef.id).set({
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

  return jsonResult({
    success: true,
    messageId: relayRef.id,
    action: args.action,
    relay: true,
    message: `Message sent. ID: "${relayRef.id}"`,
  });
}

export async function getMessagesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetMessagesSchema.parse(rawArgs);
  const db = getFirestore();

  let query: admin.firestore.Query = db
    .collection(`users/${auth.userId}/relay`)
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

export async function getDeadLettersHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Only accessible by ISO and Flynn (legacy/mobile keys)
  if (auth.programId !== "legacy" && auth.programId !== "mobile" && auth.programId !== "iso") {
    return jsonResult({
      success: false,
      error: "Dead letter queue is only accessible by ISO and Flynn.",
    });
  }

  const args = GetDeadLettersSchema.parse(rawArgs);
  const db = getFirestore();

  const snapshot = await db
    .collection(`users/${auth.userId}/dead_letters`)
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

export async function listGroupsHandler(_auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  const groups: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(PROGRAM_GROUPS)) {
    groups[name] = [...members];
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, groups, message: `${Object.keys(groups).length} groups available` }) }],
  };
}
