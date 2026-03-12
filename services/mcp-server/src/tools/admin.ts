/**
 * Admin Domain Registry — Administrative operations tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { mergeAccountsHandler } from "../modules/account-merge.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  admin_merge_accounts: mergeAccountsHandler,
};

export const definitions = [
  {
    name: "admin_merge_accounts",
    description: "Merge an alternate Firebase UID into a canonical account. Admin only. Maps the alternate UID to the canonical tenant so all data access is unified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Email address for the account" },
        canonicalUid: { type: "string", description: "The canonical Firebase UID to merge into" },
        alternateUid: { type: "string", description: "The alternate Firebase UID to merge from" },
      },
      required: ["email", "canonicalUid", "alternateUid"],
    },
  },
];
