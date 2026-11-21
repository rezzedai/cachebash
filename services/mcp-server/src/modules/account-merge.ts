/**
 * Account Merge Module — Admin-only tool to merge alternate UIDs
 * into a canonical account.
 */

import { z } from "zod";
import { getFirestore } from "../firebase/client.js";
import { mergeAccounts } from "../auth/tenant-resolver.js";
import type { AuthContext } from "../auth/authValidator.js";
import { hasFleetAdminCapability } from "../auth/ownerAuthz.js";

import { logDenial, denialPrincipal } from "../auth/denialLog.js";
const MergeAccountsSchema = z.object({
  email: z.string().email().max(200),
  canonicalUid: z.string().min(1).max(128),
  alternateUid: z.string().min(1).max(128),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const mayMergeInto = (tenantUid: string, canonicalUid: string): boolean => canonicalUid === tenantUid;

export async function mergeAccountsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin gate (RD-5 PR-L row 28): the literal fleet.admin capability. No program name confers it, and wildcard does not satisfy it.
  if (!hasFleetAdminCapability(auth)) {
    const caller = denialPrincipal(auth);
    logDenial({ principal: caller, tool: "admin_merge_accounts", subject: null, code: "MISSING_CAPABILITY" });
    return jsonResult({ success: false, error: `Admin only: merge_accounts requires literal fleet.admin (caller "${caller}")` });
  }

  const args = MergeAccountsSchema.parse(rawArgs);

  // L-D10 option 2: the canonical account is the caller's own tenant. A fleet.admin key never folds a uid into another tenant's account.
  if (!mayMergeInto(auth.userId, args.canonicalUid)) {
    const caller = denialPrincipal(auth);
    logDenial({ principal: caller, tool: "admin_merge_accounts", subject: args.canonicalUid, code: "FOREIGN_SUBJECT" });
    return jsonResult({ success: false, error: `Access denied: "${caller}" cannot merge into "${args.canonicalUid}"` });
  }
  const db = getFirestore();

  const result = await mergeAccounts(db, args.email, args.canonicalUid, args.alternateUid);

  if (!result.success) {
    return jsonResult({ success: false, error: result.error });
  }

  return jsonResult({
    success: true,
    email: args.email,
    canonicalUid: args.canonicalUid,
    alternateUid: args.alternateUid,
    message: `UID ${args.alternateUid} merged into canonical account ${args.canonicalUid}`,
  });
}
