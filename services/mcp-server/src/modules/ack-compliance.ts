/**
 * ACK Compliance Module — Track DIRECTIVE/ACK audit trail.
 * Collection: tenants/{uid}/directive_audit
 *
 * W1.2.3: Log all DIRECTIVE messages and correlate ACK responses.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const GetAckComplianceSchema = z.object({
  programId: z.string().max(100).optional(),
  period: z.enum(["today", "this_week", "this_month", "all"]).default("this_month"),
});

function periodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this_week": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case "this_month": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d;
    }
    default:
      return new Date(0); // Beginning of time for "all"
  }
}

/**
 * Log a DIRECTIVE message to the audit trail.
 */
export async function logDirective(
  userId: string,
  messageId: string,
  source: string,
  target: string,
  payload: string,
  threadId?: string,
  sessionId?: string
): Promise<void> {
  const db = getFirestore();
  const now = serverTimestamp();

  await db.collection(`tenants/${userId}/directive_audit`).doc(messageId).set({
    messageId,
    source,
    target,
    payload,
    threadId: threadId || null,
    sessionId: sessionId || null,
    createdAt: now,
    ackReceived: false,
    ackMessageId: null,
    ackTimestamp: null,
  });
}

/**
 * Mark a DIRECTIVE as acknowledged when an ACK is received.
 */
export async function markDirectiveAcknowledged(
  userId: string,
  directiveMessageId: string,
  ackMessageId: string
): Promise<void> {
  const db = getFirestore();
  const auditRef = db.doc(`tenants/${userId}/directive_audit/${directiveMessageId}`);

  await auditRef.update({
    ackReceived: true,
    ackMessageId,
    ackTimestamp: serverTimestamp(),
  });
}

/**
 * Get ACK compliance report.
 * Returns statistics on DIRECTIVE messages and their ACK status.
 */
export async function getAckComplianceHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetAckComplianceSchema.parse(rawArgs || {});
  const db = getFirestore();

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/directive_audit`);

  if (args.period !== "all") {
    const start = periodStart(args.period);
    const startTimestamp = admin.firestore.Timestamp.fromDate(start);
    query = query.where("createdAt", ">=", startTimestamp);
  }

  if (args.programId) {
    query = query.where("source", "==", args.programId);
  }

  query = query.orderBy("createdAt", "desc");

  const snapshot = await query.get();

  const directives = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      messageId: data.messageId,
      source: data.source,
      target: data.target,
      payload: data.payload,
      threadId: data.threadId || null,
      sessionId: data.sessionId || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      ackReceived: data.ackReceived || false,
      ackMessageId: data.ackMessageId || null,
      ackTimestamp: data.ackTimestamp?.toDate?.()?.toISOString() || null,
    };
  });

  const totalDirectives = directives.length;
  const acknowledged = directives.filter((d) => d.ackReceived).length;
  const unacknowledged = totalDirectives - acknowledged;
  const complianceRate = totalDirectives > 0
    ? Math.round((acknowledged / totalDirectives) * 10000) / 100
    : 100;

  return jsonResult({
    success: true,
    period: args.period,
    programId: args.programId || "all",
    totalDirectives,
    acknowledged,
    unacknowledged,
    complianceRate,
    directives,
    message: `ACK compliance: ${complianceRate}% (${acknowledged}/${totalDirectives} directives acknowledged)`,
  });
}
