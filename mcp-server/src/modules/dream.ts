/**
 * Dream Module — Dream Mode lifecycle.
 * Dreams are tasks with type: "dream" in users/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { transition } from "../lifecycle/engine.js";
import { z } from "zod";

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
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
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
