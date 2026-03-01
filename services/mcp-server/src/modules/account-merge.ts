/**
 * Account Merge Module — Admin-only tool to merge alternate UIDs
 * into a canonical account.
 */

import { z } from "zod";
import { getFirestore } from "../firebase/client.js";
import { mergeAccounts } from "../auth/tenant-resolver.js";
import type { AuthContext } from "../auth/authValidator.js";

const MergeAccountsSchema = z.object({
  email: z.string().email().max(200),
  canonicalUid: z.string().min(1).max(128),
  alternateUid: z.string().min(1).max(128),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function mergeAccountsHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  // Admin gate: only legacy (Flynn) keys can merge accounts
  if (auth.programId !== "legacy") {
    return jsonResult({ success: false, error: "Admin only: merge_accounts requires legacy (admin) key" });
  }

  const args = MergeAccountsSchema.parse(rawArgs);
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
