/**
 * Signal Module — Human↔program communication.
 * ask_question + get_response → tasks collection (type: "question")
 * send_alert → relay collection (short TTL)
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { encryptQuestionData, decrypt, isEncrypted } from "../encryption/crypto.js";
import { z } from "zod";

const AskQuestionSchema = z.object({
  question: z.string().max(2000),
  options: z.array(z.string().max(100)).max(5).optional(),
  context: z.string().max(500).optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  encrypt: z.boolean().default(true),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  projectId: z.string().optional(),
});

const GetResponseSchema = z.object({
  questionId: z.string(),
});

const SendAlertSchema = z.object({
  message: z.string().max(2000),
  alertType: z.enum(["error", "warning", "success", "info"]).default("info"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  context: z.string().max(500).optional(),
  sessionId: z.string().optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function askQuestionHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = AskQuestionSchema.parse(rawArgs);
  const db = getFirestore();

  const preview = args.question.length > 50 ? args.question.substring(0, 47) + "..." : args.question;
  const shouldEncrypt = args.encrypt !== false;

  let questionContent: Record<string, unknown>;
  if (shouldEncrypt) {
    const enc = encryptQuestionData(
      { question: args.question, options: args.options, context: args.context },
      auth.encryptionKey
    );
    questionContent = {
      content: enc.question,
      options: enc.options,
      context: enc.context,
      encrypted: true,
    };
  } else {
    questionContent = {
      content: args.question,
      options: args.options || null,
      context: args.context || null,
      encrypted: false,
    };
  }

  // Questions are tasks with type: "question"
  const taskData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    type: "question",
    title: preview,
    instructions: "",
    preview,
    source: "program",
    target: "user",
    priority: args.priority,
    action: "queue",
    status: "created",
    question: {
      content: questionContent.content,
      options: questionContent.options,
      context: questionContent.context,
      response: null,
      answeredAt: null,
    },
    projectId: args.projectId || null,
    threadId: args.threadId || null,
    replyTo: args.inReplyTo || null,
    createdAt: serverTimestamp(),
    encrypted: shouldEncrypt,
    archived: false,
  };

  const ref = await db.collection(`tenants/${auth.userId}/tasks`).add(taskData);

  return jsonResult({
    success: true,
    questionId: ref.id,
    encrypted: shouldEncrypt,
    message: `Question sent to user's device${shouldEncrypt ? " (encrypted)" : ""}. Use get_response with questionId "${ref.id}" to check for a response.`,
  });
}

export async function getResponseHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetResponseSchema.parse(rawArgs);
  const db = getFirestore();

  const doc = await db.doc(`tenants/${auth.userId}/tasks/${args.questionId}`).get();
  if (!doc.exists) {
    return jsonResult({ success: false, error: "Question not found" });
  }

  const data = doc.data()!;
  const question = data.question as Record<string, unknown> | undefined;

  if (data.status === "done" && question?.response) {
    let response = question.response as string;

    if (data.encrypted && isEncrypted(response)) {
      try {
        response = decrypt(response, auth.encryptionKey);
      } catch {
        return jsonResult({
          success: true,
          answered: true,
          response,
          encrypted: true,
          decryptionFailed: true,
          answeredAt: (question.answeredAt as any)?.toDate?.()?.toISOString() || null,
        });
      }
    }

    return jsonResult({
      success: true,
      answered: true,
      response,
      answeredAt: (question.answeredAt as any)?.toDate?.()?.toISOString() || null,
    });
  }

  if (data.status === "archived") {
    return jsonResult({
      success: true,
      answered: false,
      expired: true,
      message: "Question has expired without a response",
    });
  }

  return jsonResult({
    success: true,
    answered: false,
    status: data.status,
    message: "Waiting for user response",
  });
}

export async function sendAlertHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SendAlertSchema.parse(rawArgs);
  const db = getFirestore();

  const preview = args.message.length > 50 ? args.message.substring(0, 47) + "..." : args.message;
  const TTL_SECONDS = 3600; // 1 hour for alerts
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + TTL_SECONDS * 1000);

  // Alerts go to relay with short TTL
  const alertData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    source: "program",
    target: "user",
    message_type: "STATUS",
    payload: args.message,
    priority: args.priority,
    action: "queue",
    sessionId: args.sessionId || null,
    status: "pending",
    ttl: TTL_SECONDS,
    expiresAt,
    alertType: args.alertType,
    context: args.context || null,
    createdAt: serverTimestamp(),
  };

  const ref = await db.collection(`tenants/${auth.userId}/relay`).add(alertData);

  // Also write to tasks for mobile visibility
  await db.collection(`tenants/${auth.userId}/tasks`).doc(ref.id).set({
    schemaVersion: '2.2' as const,
    type: "task",
    title: `[Alert: ${args.alertType}] ${preview}`,
    instructions: args.message,
    preview,
    source: "program",
    target: "user",
    priority: args.priority,
    action: "queue",
    status: "created",
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
  });

  return jsonResult({
    success: true,
    alertId: ref.id,
    alertType: args.alertType,
    message: `Alert sent to user's device. Alert ID: "${ref.id}"`,
  });
}
