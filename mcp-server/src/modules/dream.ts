/**
 * Dream Module — Dream Mode lifecycle.
 * Dreams are tasks with type: "dream" in users/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { transition } from "../lifecycle/engine.js";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * Peek for pending dream sessions. Lightweight check for shell hooks.
 */
export async function dreamPeekHandler(auth: AuthContext, _rawArgs: unknown): Promise<ToolResult> {
  const db = getFirestore();
  const snapshot = await db
    .collection(`users/${auth.userId}/tasks`)
    .where("type", "==", "dream")
    .where("status", "==", "created")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return jsonResult({ hasPending: false });
  }

  const doc = snapshot.docs[0];
  const data = doc.data();
  return jsonResult({
    hasPending: true,
    dream: {
      id: doc.id,
      agent: data.dream?.agent,
      branch: data.dream?.branch,
      budget_cap_usd: data.dream?.budget_cap_usd,
      timeout_hours: data.dream?.timeout_hours,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    },
  });
}

/**
 * Atomically activate a dream session.
 */
export async function dreamActivateHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = z.object({ dreamId: z.string() }).parse(rawArgs);
  const db = getFirestore();
  const dreamRef = db.doc(`users/${auth.userId}/tasks/${args.dreamId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(dreamRef);
      if (!doc.exists) return { error: "Dream not found" };

      const data = doc.data()!;
      if (data.type !== "dream") return { error: "Not a dream task" };
      if (data.status !== "created") return { error: `Dream not activatable (status: ${data.status})` };

      transition("dream", "created", "active");

      tx.update(dreamRef, {
        status: "active",
        startedAt: FieldValue.serverTimestamp(),
      });

      return { data };
    });

    if ("error" in result) return jsonResult({ success: false, error: result.error });

    return jsonResult({
      success: true,
      dreamId: args.dreamId,
      agent: result.data!.dream?.agent,
      branch: result.data!.dream?.branch,
      budget_cap_usd: result.data!.dream?.budget_cap_usd,
      message: "Dream activated",
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to activate dream: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

const CreateDreamSchema = z.object({
  agent: z.string().max(100),
  title: z.string().max(200),
  instructions: z.string().max(4000).optional(),
  branch: z.string().max(100).optional(),
  budget_cap_usd: z.number().positive().max(100).default(5),
  timeout_hours: z.number().positive().max(24).default(8),
  target: z.string().max(100).optional(),
});

/**
 * Create a dream task from mobile or portal.
 */
export async function createDreamHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateDreamSchema.parse(rawArgs);
  const db = getFirestore();

  const now = serverTimestamp();
  const expiresAt = new Date(Date.now() + args.timeout_hours * 60 * 60 * 1000);

  const dreamData = {
    type: "dream",
    status: "created",
    title: args.title,
    instructions: args.instructions || null,
    target: args.target || args.agent,
    source: auth.programId,
    createdBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    dream: {
      agent: args.agent,
      branch: args.branch || null,
      budget_cap_usd: args.budget_cap_usd,
      timeout_hours: args.timeout_hours,
      budget_consumed_usd: 0,
    },
  };

  const docRef = await db.collection(`users/${auth.userId}/tasks`).add(dreamData);

  return jsonResult({
    success: true,
    dreamId: docRef.id,
    message: `Dream created: "${args.title}"`,
    budget_cap_usd: args.budget_cap_usd,
    timeout_hours: args.timeout_hours,
  });
}

const KillDreamSchema = z.object({
  dreamId: z.string(),
  reason: z.string().max(500).optional(),
});

/**
 * Kill a running dream session immediately. Emergency stop.
 */
export async function killDreamHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = KillDreamSchema.parse(rawArgs);
  const db = getFirestore();
  const dreamRef = db.doc(`users/${auth.userId}/tasks/${args.dreamId}`);

  try {
    const dreamDoc = await dreamRef.get();
    if (!dreamDoc.exists) {
      return jsonResult({ success: false, error: "Dream not found" });
    }

    const dreamData = dreamDoc.data()!;
    if (dreamData.type !== "dream") {
      return jsonResult({ success: false, error: "Not a dream task" });
    }

    // Transition to failed using lifecycle engine
    const currentStatus = dreamData.status;
    if (currentStatus === "failed" || currentStatus === "derezzed") {
      return jsonResult({ success: false, error: `Dream already ${currentStatus}` });
    }

    // Validate the transition
    transition("dream", currentStatus, "failed");

    // Update the dream task
    await dreamRef.update({
      status: "failed",
      "dream.killReason": args.reason || "Killed by user",
      "dream.killedAt": serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return jsonResult({
      success: true,
      dreamId: args.dreamId,
      message: `Dream killed: ${args.reason || "User requested"}`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to kill dream: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
