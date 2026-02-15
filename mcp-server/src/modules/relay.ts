/**
 * Relay Module — Ephemeral inter-program messages.
 * Collection: users/{uid}/relay
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { RELAY_DEFAULT_TTL_SECONDS } from "../types/relay.js";
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
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function sendMessageHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SendMessageSchema.parse(rawArgs);
  const db = getFirestore();

  const ttl = args.ttl || RELAY_DEFAULT_TTL_SECONDS;
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttl * 1000);

  const relayData: Record<string, unknown> = {
    source: args.source,
    target: args.target,
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
    provenance: args.provenance || null,
    createdAt: serverTimestamp(),
  };

  // Write to relay (data plane)
  const relayRef = await db.collection(`users/${auth.userId}/relay`).add(relayData);

  // Also write to tasks collection for mobile app visibility
  const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
  await db.collection(`users/${auth.userId}/tasks`).doc(relayRef.id).set({
    type: "task",
    title: `[${args.source}→${args.target}] ${args.message_type}`,
    instructions: args.message,
    preview,
    source: args.source,
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

  const query = db
    .collection(`users/${auth.userId}/relay`)
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc");

  const snapshot = await query.get();

  // Filter by target: return messages for this session or with no target
  const target = args.target || args.sessionId;
  const filtered = snapshot.docs.filter((doc) => {
    const t = doc.data().target;
    return !t || t === target || t === "all";
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
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
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
        });

        claimed.push({
          id,
          message: data.payload,
          source: data.source,
          message_type: data.message_type,
          action: data.action,
          priority: data.priority,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        });
      }
      return claimed;
    });

    return jsonResult({
      success: true,
      hasInterrupts: result.length > 0,
      interrupts: result,
      message: result.length > 0 ? `${result.length} interrupt(s) from user` : "No pending interrupts",
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to claim messages: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
