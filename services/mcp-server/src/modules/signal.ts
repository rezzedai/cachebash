/**
 * Signal Module — Human↔program communication.
 * ask_question + get_response → tasks collection (type: "question")
 * send_alert → relay collection (short TTL)
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { encryptQuestionData, decrypt, isEncrypted } from "../encryption/crypto.js";
import { CONSTANTS } from "../config/constants.js";
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
    // W2e: a question awaiting a human answer must never silently expire — the
    // never-expires sentinel, same encoding as create_task's ttl:0 branch. Before
    // this, this write had no expiresAt at all, contributing to the field-less
    // population PLAN-W1 backfills and PLAN-W4's reaper must never mistake for
    // "already expired".
    ttl: 0,
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(CONSTANTS.ttl.neverExpiresSentinel)),
    // WP-1: target:"user" tasks are mobile-app visibility artifacts, not work a
    // program's get_tasks() boot poll should ever claim — false keeps this out
    // of the WP-2 requires_action==true default query, matching relay.ts's
    // mirror convention for non-RESULT informational docs.
    requires_action: false,
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

export interface AlertDocInput {
  message: string;
  alertType: "error" | "warning" | "success" | "info";
  priority: "low" | "normal" | "high";
  context?: string | null;
  sessionId?: string | null;
  /** Relay `source`. sendAlertHandler uses "program"; the watchdog uses "watchdog". */
  source?: string;
  /**
   * Relay `target`. "user" (default) is the FCM-only shape sendAlertHandler writes.
   * "slack-bridge" is what onSlackBridge keys on; onRelayCreate pushes to devices
   * for ANY target when priority is "high", so one doc with target "slack-bridge"
   * reaches both channels.
   */
  relayTarget?: string;
}

/**
 * The alert shape: a relay doc plus its mirrored task. Shared by send_alert and
 * the schedule executor's watch kind so the two cannot drift apart.
 *
 * `txn` is optional. With it both docs are created inside the caller's
 * transaction (the relay id is minted up front); without it the relay is
 * `add`ed and the task mirror `set` after, exactly as send_alert always did.
 */
export async function writeAlertDocs(
  db: FirebaseFirestore.Firestore,
  userId: string,
  input: AlertDocInput,
  txn?: FirebaseFirestore.Transaction,
): Promise<string> {
  const preview = input.message.length > 50 ? input.message.substring(0, 47) + "..." : input.message;
  const TTL_SECONDS = 3600; // 1 hour for alerts
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + TTL_SECONDS * 1000);

  // Alerts go to relay with short TTL
  const alertData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    source: input.source ?? "program",
    target: input.relayTarget ?? "user",
    message_type: "STATUS",
    payload: input.message,
    priority: input.priority,
    action: "queue",
    sessionId: input.sessionId || null,
    status: "pending",
    ttl: TTL_SECONDS,
    expiresAt,
    alertType: input.alertType,
    context: input.context || null,
    createdAt: serverTimestamp(),
  };

  // Also write to tasks for mobile visibility. W2e: the task mirror tracks the
  // relay record's own ttl/expiresAt (computed once, above) rather than being
  // field-less — an alert whose relay half has already expired is a task nobody
  // will action, so giving it the same 1h window makes it reapable instead of
  // permanent scan ballast. Same "one resolved value, both records" pattern as
  // W2c's dispatch()/directive-record fix.
  const taskData: Record<string, unknown> = {
    schemaVersion: '2.2' as const,
    type: "task",
    title: `[Alert: ${input.alertType}] ${preview}`,
    instructions: input.message,
    preview,
    source: input.source ?? "program",
    target: "user",
    priority: input.priority,
    action: "queue",
    status: "created",
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
    ttl: TTL_SECONDS,
    expiresAt,
    // WP-1: target:"user" alert mirror — informational, not program-actionable.
    // See ask_question's write above for the same rationale.
    requires_action: false,
  };

  const relayCol = db.collection(`tenants/${userId}/relay`);
  const taskCol = db.collection(`tenants/${userId}/tasks`);

  if (txn) {
    const relayRef = relayCol.doc();
    txn.create(relayRef, alertData);
    txn.create(taskCol.doc(relayRef.id), taskData);
    return relayRef.id;
  }

  const ref = await relayCol.add(alertData);
  await taskCol.doc(ref.id).set(taskData);
  return ref.id;
}

export async function sendAlertHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SendAlertSchema.parse(rawArgs);
  const db = getFirestore();

  const alertId = await writeAlertDocs(db, auth.userId, {
    message: args.message,
    alertType: args.alertType,
    priority: args.priority,
    context: args.context,
    sessionId: args.sessionId,
  });

  return jsonResult({
    success: true,
    alertId,
    alertType: args.alertType,
    message: `Alert sent to user's device. Alert ID: "${alertId}"`,
  });
}
