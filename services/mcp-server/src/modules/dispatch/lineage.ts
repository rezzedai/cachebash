/**
 * Task Lineage Query — Follows lineage links to build ancestor/descendant chains.
 */

import { getFirestore } from "../../firebase/client.js";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import * as admin from "firebase-admin";
import { type ToolResult, jsonResult } from "./shared.js";

const GetTaskLineageSchema = z.object({
  taskId: z.string(),
});

/** Lineage link field names on a task document */
const LINEAGE_FIELDS = ["replayOf", "retriedFrom", "reassignedFrom", "escalatedFrom"] as const;

interface LineageNode {
  id: string;
  title: string;
  status: string;
  target: string;
  createdAt: string | null;
  completedAt: string | null;
  linkType?: string;  // which lineage field connects to parent
}

export async function getTaskLineageHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetTaskLineageSchema.parse(rawArgs);
  const db = getFirestore();
  const tasksCol = `tenants/${auth.userId}/tasks`;

  // 1. Fetch the target task
  const targetDoc = await db.doc(`${tasksCol}/${args.taskId}`).get();
  if (!targetDoc.exists) {
    return jsonResult({ success: false, error: "Task not found" });
  }

  const targetData = targetDoc.data()!;
  const targetNode: LineageNode = {
    id: targetDoc.id,
    title: targetData.title || "",
    status: targetData.status || "unknown",
    target: targetData.target || "",
    createdAt: targetData.createdAt?.toDate?.()?.toISOString() || null,
    completedAt: targetData.completedAt?.toDate?.()?.toISOString() || null,
  };

  // 2. Walk ancestors (follow lineage fields up the chain)
  const ancestors: LineageNode[] = [];
  let currentData = targetData;
  let currentId = args.taskId;
  const visited = new Set<string>([currentId]);
  const MAX_DEPTH = 20; // Safety limit to prevent infinite loops

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    // Find which lineage field points to a parent
    let parentId: string | null = null;
    let linkType: string | null = null;

    for (const field of LINEAGE_FIELDS) {
      if (currentData[field] && typeof currentData[field] === "string") {
        parentId = currentData[field] as string;
        linkType = field;
        break;
      }
    }

    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);

    const parentDoc = await db.doc(`${tasksCol}/${parentId}`).get();
    if (!parentDoc.exists) break;

    const parentData = parentDoc.data()!;
    ancestors.unshift({
      id: parentDoc.id,
      title: parentData.title || "",
      status: parentData.status || "unknown",
      target: parentData.target || "",
      createdAt: parentData.createdAt?.toDate?.()?.toISOString() || null,
      completedAt: parentData.completedAt?.toDate?.()?.toISOString() || null,
      linkType: linkType || undefined,
    });

    currentData = parentData;
    currentId = parentId;
  }

  // 3. Find descendants (tasks where any lineage field points to this task)
  const descendants: LineageNode[] = [];
  for (const field of LINEAGE_FIELDS) {
    const snap = await db.collection(tasksCol)
      .where(field, "==", args.taskId)
      .limit(50)
      .get();

    for (const doc of snap.docs) {
      if (visited.has(doc.id)) continue;
      visited.add(doc.id);
      const data = doc.data();
      descendants.push({
        id: doc.id,
        title: data.title || "",
        status: data.status || "unknown",
        target: data.target || "",
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
        linkType: field,
      });
    }
  }

  // Also find tasks whose lineageRoot points to this task
  const rootSnap = await db.collection(tasksCol)
    .where("lineageRoot", "==", args.taskId)
    .limit(50)
    .get();

  for (const doc of rootSnap.docs) {
    if (visited.has(doc.id)) continue;
    visited.add(doc.id);
    const data = doc.data();
    descendants.push({
      id: doc.id,
      title: data.title || "",
      status: data.status || "unknown",
      target: data.target || "",
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
      linkType: "lineageRoot",
    });
  }

  // 4. Determine root
  const root = ancestors.length > 0 ? ancestors[0].id : args.taskId;

  return jsonResult({
    success: true,
    root,
    ancestors,
    task: targetNode,
    descendants,
    depth: ancestors.length,
    stateTransitions: targetData.stateTransitions || [],
  });
}

const ExportTasksSchema = z.object({
  format: z.enum(["json"]).default("json"),
  status: z.string().optional(),
  since: z.string().optional(),  // ISO 8601 date
  limit: z.number().min(1).max(500).default(100),
});

export async function exportTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ExportTasksSchema.parse(rawArgs);
  const db = getFirestore();

  let query: admin.firestore.Query = db.collection(`tenants/${auth.userId}/tasks`);

  // Filter by status if provided
  if (args.status) {
    query = query.where("status", "==", args.status);
  }

  // Filter by date if provided
  if (args.since) {
    const sinceDate = new Date(args.since);
    if (isNaN(sinceDate.getTime())) {
      return jsonResult({ success: false, error: "Invalid 'since' date format. Use ISO 8601." });
    }
    const { Timestamp } = admin.firestore;
    query = query.where("createdAt", ">=", Timestamp.fromDate(sinceDate));
  }

  const snapshot = await query
    .orderBy("createdAt", "desc")
    .limit(args.limit)
    .get();

  const tasks = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type || "task",
      title: data.title || "",
      status: data.status,
      source: data.source,
      target: data.target,
      priority: data.priority || "normal",
      action: data.action || "queue",
      projectId: data.projectId || null,
      completed_status: data.completed_status || null,
      model: data.model || null,
      provider: data.provider || null,
      result: data.result || null,
      // Timestamps
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      startedAt: data.startedAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
      // Lineage fields (Wave 11)
      replayOf: data.replayOf || null,
      retriedFrom: data.retriedFrom || null,
      reassignedFrom: data.reassignedFrom || null,
      escalatedFrom: data.escalatedFrom || null,
      lineageRoot: data.lineageRoot || null,
      // State transitions (Wave 11)
      stateTransitions: data.stateTransitions || [],
      // Telemetry
      tokens_in: data.tokens_in || null,
      tokens_out: data.tokens_out || null,
      cost_usd: data.cost_usd || null,
      attempt_count: data.attempt_count || 0,
      retryCount: data.retryCount || 0,
    };
  });

  return jsonResult({
    success: true,
    format: args.format,
    count: tasks.length,
    tasks,
  });
}
