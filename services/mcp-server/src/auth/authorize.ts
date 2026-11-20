/**
 * Key-path authorization (RD-5 PR-E, ISO plan C-2 and amendment 4).
 *
 * One function decides whether a credential may act on a keyIndex document:
 *   sameTenant AND (sameProgram OR key admin)
 *
 * - sameTenant compares RESOLVED tenants on both sides (resolveTenant over canonical_accounts).
 *   A raw keyIndex.userId never decides: the dispatcher key 69cc7291 carries an alternate uid.
 * - sameProgram compares credentialPrincipal(auth) with keyDoc.programId. Program names repeat
 *   across tenants, so the program check alone is never enough.
 * - key admin is isKeyAdmin: literal `fleet.admin` only. "*" never satisfies it, and no program
 *   name does.
 * - a key document with no programId is denied with reason "program", for every caller, admin included.
 *
 * A tenant mismatch is reported as "tenant", which callers answer exactly like a missing key.
 * Otherwise the key hash would tell a caller whether another tenant holds that key.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { AuthContext } from "./authValidator.js";
import { credentialPrincipal, isKeyAdmin } from "./ownerAuthz.js";
import { resolveTenant } from "./tenant-resolver.js";

export interface KeyDocSubject {
  userId?: unknown;
  programId?: unknown;
}

export type KeyDecision =
  | { allowed: true; via: "self" | "fleet.admin"; principal: string; subject: string }
  | { allowed: false; reason: "tenant" | "program"; principal: string; subject: string };

/** Memoises resolveTenant for one request so a list of N keys costs one lookup per distinct uid. */
export type TenantOf = (uid: string) => Promise<string>;

export function tenantResolver(db: Firestore): TenantOf {
  const memo = new Map<string, Promise<string>>();
  return (uid: string) => {
    let hit = memo.get(uid);
    if (!hit) {
      hit = resolveTenant(uid, db).then((r) => r.tenantId);
      memo.set(uid, hit);
      // a failure is not memoised: the next call retries
      hit.catch(() => memo.delete(uid));
    }
    return hit;
  };
}

export async function authorizeKeySubject(
  auth: AuthContext,
  keyDoc: KeyDocSubject,
  tenantOf: TenantOf,
): Promise<KeyDecision> {
  const principal = credentialPrincipal(auth);
  const hasProgram = typeof keyDoc.programId === "string" && keyDoc.programId !== "";
  const subject = hasProgram ? (keyDoc.programId as string) : "";

  const docUid = typeof keyDoc.userId === "string" ? keyDoc.userId : "";
  if (!docUid) return { allowed: false, reason: "tenant", principal, subject };

  const [callerTenant, docTenant] = await Promise.all([tenantOf(auth.userId), tenantOf(docUid)]);
  if (callerTenant !== docTenant) return { allowed: false, reason: "tenant", principal, subject };

  if (!hasProgram) return { allowed: false, reason: "program", principal, subject };
  if (subject === principal) return { allowed: true, via: "self", principal, subject };
  if (isKeyAdmin(auth)) return { allowed: true, via: "fleet.admin", principal, subject };
  return { allowed: false, reason: "program", principal, subject };
}
