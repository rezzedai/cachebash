/**
 * Trace Module — Execution tracing for debugging sprints.
 * Collection: users/{uid}/ledger (type: trace)
 * Fire-and-forget writes — never blocks the response.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { z } from "zod";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Extract correlation context from tool args */
export function extractContext(tool: string, args: unknown): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (typeof a.sprintId === "string") ctx.sprintId = a.sprintId;
    if (typeof a.taskId === "string") ctx.taskId = a.taskId;
    if (typeof a.storyId === "string") ctx.storyId = a.storyId;
  }
  return ctx;
}

/** Truncate long string values for storage */
export function sanitizeArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args;
  if (typeof args === "string") return args.length > 200 ? args.substring(0, 200) + "..." : args;
  if (Array.isArray(args)) return args.map(sanitizeArgs);
  if (typeof args === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      result[key] = sanitizeArgs(value);
    }
    return result;
  }
  return args;
}

/** Fire-and-forget trace write */
export function traceToolCall(
  userId: string,
  tool: string,
  programId: string,
  endpoint: string,
  sessionId: string | undefined,
  args: unknown,
  resultSummary: string,
  durationMs: number,
  success: boolean,
  error?: string
): void {
  const db = getFirestore();
  const context = extractContext(tool, args);
  const truncatedResult = resultSummary.length > 500 ? resultSummary.substring(0, 500) + "..." : resultSummary;

  db.collection(`users/${userId}/ledger`).add({
    type: "trace",
    tool,
    programId,
    endpoint,
    sessionId: sessionId || null,
    args: sanitizeArgs(args),
    resultSummary: truncatedResult,
    context,
    durationMs,
    success,
    error: error || null,
    createdAt: serverTimestamp(),
  }).catch((err) => {
    console.error("[Trace] Failed to write trace:", err);
  });
}

const QueryTracesSchema = z.object({
  sprintId: z.string().optional(),
  taskId: z.string().optional(),
  programId: z.string().max(100).optional(),
  tool: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export async function queryTracesHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // ISO/Flynn gate
  if (!["iso", "flynn", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "query_traces is only accessible by ISO and Flynn.",
    });
  }

  const args = QueryTracesSchema.parse(rawArgs || {});
  const db = getFirestore();
  let query: admin.firestore.Query = db.collection(`users/${auth.userId}/ledger`).where("type", "==", "trace");

  if (args.sprintId) {
    query = query.where("context.sprintId", "==", args.sprintId);
  }
  if (args.taskId) {
    query = query.where("context.taskId", "==", args.taskId);
  }
  if (args.programId) {
    query = query.where("programId", "==", args.programId);
  }
  if (args.tool) {
    query = query.where("tool", "==", args.tool);
  }

  query = query.orderBy("createdAt", "desc");

  if (args.since) {
    query = query.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(new Date(args.since)));
  }
  if (args.until) {
    query = query.where("createdAt", "<=", admin.firestore.Timestamp.fromDate(new Date(args.until)));
  }

  query = query.limit(args.limit);

  const snapshot = await query.get();
  const traces = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      tool: data.tool,
      programId: data.programId,
      endpoint: data.endpoint,
      sessionId: data.sessionId,
      context: data.context,
      durationMs: data.durationMs,
      success: data.success,
      error: data.error,
      resultSummary: data.resultSummary,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    };
  });

  return jsonResult({
    success: true,
    count: traces.length,
    traces,
  });
}
