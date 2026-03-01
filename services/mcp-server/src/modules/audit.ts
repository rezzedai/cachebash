/**
 * Audit Module — Query Gate audit log.
 * Collection: tenants/{uid}/ledger (type: audit)
 * Read-only. Admin only.
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

const GetAuditSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  allowed: z.boolean().optional(),
  programId: z.string().max(100).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function getAuditHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin only (legacy/mobile keys)
  if (auth.programId !== "legacy" && auth.programId !== "mobile" && auth.programId !== "orchestrator" && auth.programId !== "dispatcher") {
    return jsonResult({
      success: false,
      error: "Audit log is only accessible by admin.",
    });
  }

  const args = GetAuditSchema.parse(rawArgs);
  const db = getFirestore();

  let query: FirebaseFirestore.Query = db
    .collection(`tenants/${auth.userId}/ledger`)
    .where("type", "==", "audit")
    .orderBy("timestamp", "desc");

  if (args.allowed !== undefined) {
    query = query.where("allowed", "==", args.allowed);
  }

  if (args.programId) {
    query = query.where("programId", "==", args.programId);
  }

  const snapshot = await query.limit(args.limit).get();

  const entries = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      correlationId: data.correlationId,
      tool: data.tool,
      programId: data.programId,
      source: data.source,
      claimedSource: data.claimedSource || null,
      endpoint: data.endpoint,
      allowed: data.allowed,
      reason: data.reason || null,
      durationMs: data.durationMs || null,
      timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
    };
  });

  return jsonResult({
    success: true,
    count: entries.length,
    entries,
    message: entries.length > 0
      ? `Found ${entries.length} audit entries`
      : "No audit entries found",
  });
}
