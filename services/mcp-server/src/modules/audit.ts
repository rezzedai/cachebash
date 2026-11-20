/**
 * Audit Module — Query Gate audit log.
 * Collection: tenants/{uid}/ledger (type: audit)
 * Read-only. Admin only.
 */

import { getFirestore } from "../firebase/client.js";
import { hasCapability } from "../middleware/gate.js";
import { resolveReadScope } from "../auth/readScope.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";

import { logDenial, denialPrincipal } from "../auth/denialLog.js";
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
  if (!hasCapability(auth, "audit.read", "audit_get_audit")) {
    logDenial({ principal: denialPrincipal(auth), tool: "audit_get_audit", subject: null, code: "MISSING_CAPABILITY" });
    return jsonResult({
      success: false,
      error: `get_audit requires audit.read capability (caller "${denialPrincipal(auth)}").`,
    });
  }

  const args = GetAuditSchema.parse(rawArgs);
  const db = getFirestore();

  // RD-5 PR-L row 22: a foreign programId needs literal fleet.observe; no programId means the principal's own entries.
  const scope = resolveReadScope(auth, args.programId);
  if (!scope.allowed) {
    logDenial({ principal: scope.principal, tool: "audit_get_audit", subject: args.programId ?? null, code: "FOREIGN_SUBJECT" });
    return jsonResult({ success: false, error: `Access denied: "${scope.principal}" cannot read audit for "${args.programId}"` });
  }

  let query: FirebaseFirestore.Query = db
    .collection(`tenants/${auth.userId}/ledger`)
    .where("type", "==", "audit")
    .orderBy("timestamp", "desc");

  if (args.allowed !== undefined) {
    query = query.where("allowed", "==", args.allowed);
  }

  if (scope.filter) {
    query = query.where("programId", "==", scope.filter);
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
