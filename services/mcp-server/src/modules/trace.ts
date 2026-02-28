/**
 * Trace Module — Execution tracing for debugging sprints.
 * Collection: tenants/{uid}/ledger (type: trace)
 * Fire-and-forget writes — never blocks the response.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
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
    // Agent Trace L1
    if (typeof a.traceId === "string") ctx.traceId = a.traceId;
    if (typeof a.spanId === "string") ctx.spanId = a.spanId;
    if (typeof a.parentSpanId === "string") ctx.parentSpanId = a.parentSpanId;
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

  db.collection(`tenants/${userId}/ledger`).add({
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

const QueryTraceSchema = z.object({
  traceId: z.string(),
});

/** Fan-out query: find all tasks, messages, and ledger entries for a traceId */
export async function queryTraceHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin only gate
  if (!["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({ success: false, error: "query_trace is only accessible by admin." });
  }

  const args = QueryTraceSchema.parse(rawArgs);
  const db = getFirestore();
  const basePath = `tenants/${auth.userId}`;

  // Fan-out query: tasks + relay + ledger in parallel
  const [tasksSnap, relaySnap, ledgerSnap] = await Promise.all([
    db.collection(`${basePath}/tasks`)
      .where("traceId", "==", args.traceId)
      .orderBy("createdAt")
      .get(),
    db.collection(`${basePath}/relay`)
      .where("traceId", "==", args.traceId)
      .orderBy("createdAt")
      .get(),
    db.collection(`${basePath}/ledger`)
      .where("context.traceId", "==", args.traceId)
      .orderBy("createdAt")
      .get(),
  ]);

  const tasks = tasksSnap.docs.map((doc: any) => {
    const d = doc.data();
    return {
      id: doc.id,
      type: "task",
      title: d.title,
      status: d.status,
      source: d.source,
      target: d.target,
      spanId: d.spanId || null,
      parentSpanId: d.parentSpanId || null,
      createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
    };
  });

  const messages = relaySnap.docs.map((doc: any) => {
    const d = doc.data();
    return {
      id: doc.id,
      type: "message",
      source: d.source,
      target: d.target,
      message_type: d.message_type,
      status: d.status,
      spanId: d.spanId || null,
      parentSpanId: d.parentSpanId || null,
      createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
    };
  });

  const spans = ledgerSnap.docs.map((doc: any) => {
    const d = doc.data();
    return {
      id: doc.id,
      type: "span",
      tool: d.tool,
      programId: d.programId,
      durationMs: d.durationMs,
      success: d.success,
      error: d.error,
      spanId: d.context?.spanId || null,
      parentSpanId: d.context?.parentSpanId || null,
      createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
    };
  });

  // Reconstruct span tree: build parent→children index
  const allNodes = [...tasks, ...messages, ...spans];
  const childrenMap: Record<string, string[]> = {};
  const roots: string[] = [];

  for (const node of allNodes) {
    if (node.parentSpanId && node.spanId) {
      if (!childrenMap[node.parentSpanId]) childrenMap[node.parentSpanId] = [];
      childrenMap[node.parentSpanId].push(node.spanId);
    } else if (node.spanId) {
      roots.push(node.spanId);
    }
  }

  return jsonResult({
    success: true,
    traceId: args.traceId,
    trace: { tasks, messages, spans },
    tree: { roots, children: childrenMap },
    totals: { tasks: tasks.length, messages: messages.length, spans: spans.length },
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
  // Admin only gate
  if (!["orchestrator", "admin", "legacy", "mobile"].includes(auth.programId)) {
    return jsonResult({
      success: false,
      error: "query_traces is only accessible by admin.",
    });
  }

  const args = QueryTracesSchema.parse(rawArgs || {});
  const db = getFirestore();
  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/ledger`).where("type", "==", "trace");

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
