/**
 * Owner authorization for key provisioning (SARK keys.ts gate, task fesTTlPTC).
 *
 * createKey mints a NEW key under the caller's tenant with caller-chosen
 * capabilities. The capability middleware gates `keys_create_key` on
 * `keys.write` — but every "*" wildcard key satisfies that check, and every
 * Grid program defaults to ["*"]. So a leaked builder/wildcard key could mint
 * fresh admin keys for any program, turning a transient leak into durable
 * persistence (escalation). The comment in keys.ts long claimed "only Flynn's
 * userId can manage keys" but nothing enforced it.
 *
 * This adds a SECOND, independent gate on the mint path: the caller must be the
 * platform owner (Flynn) OR hold an explicit `keys.provision` grant that the
 * "*" wildcard does NOT imply.
 */
import type { AuthContext } from "./authValidator.js";
// Reuse the Flynn-only principal allowlist that already gates the OAuth flow
// (single source of truth, env-configurable via OAUTH_ALLOWED_UIDS). This is
// the same principal SARK established in PR #339 — deliberately not duplicated.
import { getAllowedUids } from "../oauth/callback.js";

/**
 * Explicit, separate key-provisioning capability. It is checked by LITERAL
 * membership below — NOT via the wildcard-expanding `hasCapability` matcher —
 * so that a "*" key does NOT satisfy it. That independence from the wildcard is
 * the entire point: it lets a non-owner key provision others ONLY when granted
 * this capability by name, and never as a side effect of holding "*".
 */
export const KEY_PROVISION_CAPABILITY = "keys.provision";

/**
 * True iff `auth` is permitted to provision (create) API keys.
 *   1. Platform owner — uid in the OAUTH_ALLOWED_UIDS allowlist (Flynn), OR
 *   2. an explicit, literal `keys.provision` grant (never implied by "*").
 */
export function isKeyProvisioner(auth: AuthContext): boolean {
  if (getAllowedUids().includes(auth.userId)) return true;
  if (Array.isArray(auth.capabilities) && auth.capabilities.includes(KEY_PROVISION_CAPABILITY)) {
    return true;
  }
  return false;
}
