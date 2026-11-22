/**
 * Owner authorization for key provisioning (SARK keys.ts gate, tasks fesTTlPTC
 * + #341 re-review).
 *
 * createKey mints a NEW key under the caller's tenant with caller-chosen
 * capabilities. The capability middleware gates `keys_create_key` on
 * `keys.write` — but every wildcard wildcard key satisfies that check, and every
 * Grid program defaults to [wildcard]. So a leaked builder/wildcard key could mint
 * fresh admin keys for any program, turning a transient leak into durable
 * persistence (escalation).
 *
 * SARK NO-GO on the first attempt (PR #341): the original gate ALSO allowed
 * `getAllowedUids().includes(auth.userId)`. That branch was a PROD NO-OP that
 * passed EVERYTHING. The whole fleet is ONE tenant, so `auth.userId` for any
 * cb_ key is the shared TENANT uid (the owner's allowlisted uid), NOT the calling
 * principal — authValidator stamps it, createKey copies it. Every program key
 * — including ~50 wildcards — carried that uid, so the owner branch was always
 * true and the literal keys.provision branch never ran. The unit test passed
 * only because it fabricated per-program userIds that do not exist in prod.
 *
 * The fix: drop the uid/owner branch entirely. The SOLE gate on the mint path
 * is a LITERAL `keys.provision` capability, matched by literal membership
 * (never the wildcard-expanding matcher), so wildcard does NOT satisfy it and no
 * program key can self-provision. The owner's provisioning principal is granted
 * `keys.provision` by name. A capability ceiling (see
 * `disallowedMintCapabilities`) additionally clamps minted caps to the caller's
 * own grant, so `keys.provision` can never be used to launder wildcards.
 */
import { holdsCapability, type Capability } from "../middleware/capabilities.js";
import type { AuthContext } from "./authValidator.js";

/**
 * Explicit, separate key-provisioning capability. It is checked by LITERAL
 * membership below — NOT via the wildcard-expanding `hasCapability` matcher —
 * so that a wildcard key does NOT satisfy it. That independence from the wildcard is
 * the entire point: it lets a principal provision keys ONLY when granted this
 * capability by name, and never as a side effect of holding wildcard. It is not in
 * any DEFAULT_CAPABILITIES role — it must be granted explicitly.
 */
export const KEY_PROVISION_CAPABILITY = "keys.provision";

/**
 * True iff `auth` may provision (create) API keys.
 *
 * The SOLE gate is a LITERAL `keys.provision` grant. uid is deliberately NOT
 * consulted: for cb_ keys it is the shared tenant uid (not the principal), so
 * any uid/owner allowlist check is a no-op that passes the entire fleet — the
 * exact prod no-op SARK rejected in #341. A wildcard wildcard key fails the literal
 * `.includes` and therefore CANNOT mint.
 */
export function isKeyProvisioner(auth: AuthContext): boolean {
  return Array.isArray(auth.capabilities)
    && auth.capabilities.includes(KEY_PROVISION_CAPABILITY);
}

/**
 * Capability ceiling for minted keys (SARK #341: clamp minted caps ⊆ caller's,
 * else `keys.provision` launders wildcards). Returns the requested capabilities
 * the caller is NOT entitled to grant.
 *
 * RD-5 PR-N: a caller holds a capability only by naming it (`holdsCapability`). A wildcard
 * key holds nothing, so it may mint nothing. A bounded provisioner (e.g. ["dispatch.read",
 * "keys.provision"]) may mint ONLY caps it literally holds, so keys.provision cannot launder a
 * capability the caller lacks into a freshly minted key.
 *
 * Empty array ⇒ every requested cap is within the caller's ceiling.
 */
export function disallowedMintCapabilities(
  callerCaps: string[] | undefined,
  requestedCaps: string[],
): string[] {
  if (!Array.isArray(callerCaps)) return [...requestedCaps];
  return requestedCaps.filter((cap) => !holdsCapability(callerCaps, cap as Capability));
}

/**
 * BUG-009 — key ADMINISTRATION (list-all / revoke-foreign), distinct from the
 * mint gate above.
 *
 * `revokeKeyHandler` guarded only on `data?.userId !== auth.userId`, and
 * `listKeysHandler` queried `where("userId","==",auth.userId)` with no further
 * check. That is the SAME prod no-op SARK rejected in #341 on the mint path:
 * the whole fleet is ONE tenant, so tenant-uid equality is satisfied by every
 * cb_ key and authorizes nothing. Consequence (confirmed live 2026-09-02 with
 * the dormant `radia` key): any program key could enumerate all 32 fleet
 * keyHashes and then revoke every one of them — a fleet-wide credential kill
 * switch reachable from the lowest-privilege key, needing no escalation.
 *
 * WHY NOT `hasCapability(auth, "fleet.read")`: it wildcard-expands, and 10 of
 * the 32 live keys hold [wildcard] — including `radia`, the key the exploit was
 * proven with. Gating on it would authorize the very caller it must stop. A
 * capability check here must be LITERAL, exactly as KEY_PROVISION_CAPABILITY is.
 *
 * WHY THE PRINCIPAL IS `keyProgramId`: it is bound to the authenticating
 * credential, the same field verifySource relies on for Identity Sovereignty
 * inv.6. Identity comes only from the credential.
 */

/**
 * The identity of the AUTHENTICATING credential: `auth.keyProgramId`. Throws when
 * it is empty, so a missing identity never reads as a principal.
 */
export function credentialPrincipal(auth: AuthContext): string {
  if (!auth.keyProgramId) {
    throw new Error("AuthContext.keyProgramId is empty: the credential carries no program identity");
  }
  return auth.keyProgramId as string;
}

/**
 * True iff `auth` may list or revoke keys belonging to OTHER programs. The only
 * source is a literal `fleet.admin` on the credential (RD-5 OD-2, C-5): wildcard never
 * satisfies it, and no program name confers it.
 */
export function isKeyAdmin(auth: AuthContext): boolean {
  return hasFleetAdminCapability(auth);
}

/**
 * FLEET_OBSERVE_CAPABILITY — R3/R4 (PDR-cachebash-authz-chokepoint, ISO plan
 * §3 PR-3). Gates cross-program reads of `gsp_bootstrap` payloads.
 *
 * Deliberately NOT `fleet.read`: `fleet.read` sits in the standard
 * provisioning preset (middleware/capabilities.ts:28,206,250) and 15 of 32
 * live keys hold it explicitly. Combined with the 11 of 32 keys holding
 * a bare wildcard list — which `hasCapability` wildcard-expands unconditionally — 26 of 32
 * keys would pass a `fleet.read` gate routed through `hasCapability`,
 * including `radia`, the key both BUG-005 and BUG-009 were proven with (plan
 * §1.1). Reusing `fleet.read`, or checking it via `hasCapability`, would
 * satisfy this requirement's own acceptance tests while shipping the exact
 * defect this PR exists to close.
 *
 * Minted 2026-09-02 (grid/plans/ISO-plan-authz-chokepoint.md, commit
 * `b4521fe6`), verified held by nobody before minting. Granted to exactly two
 * principals as an ADDITION to their existing wildcard (never a replacement):
 * `vector` (fleet auditor; its documented boot depends on cross-program
 * reads) and `sark` (security auditor). `iso` is deliberately NOT granted —
 * consistent with its exclusion from key admin in PR-1, it authored this
 * change. Read-back across all 137 key documents at grant time confirmed
 * exactly 2 holders, with 80 bare a bare wildcard list and 31 legacy `fleet.read` holders
 * as the control group that must NOT pass a literal check.
 */
export const FLEET_OBSERVE_CAPABILITY = "fleet.observe";

/**
 * True iff `auth`'s own capabilities literally include `fleet.observe`.
 * NEVER routed through `hasCapability` — that wildcard-expands wildcard, which
 * would re-admit all 80 wildcard-holding keys and the 31 legacy `fleet.read`
 * holders, reproducing the exact defect this capability exists to close.
 * Same discipline as `isKeyProvisioner` / `KEY_PROVISION_CAPABILITY` above.
 *
 * R4a: this function checks CAPABILITIES ONLY. It does not, and must not, by
 * itself decide who the caller is — a capability may only WIDEN a decision
 * that is already bound to `credentialPrincipal(auth)`. Call sites must check
 * `credentialPrincipal(auth) === <subject>` FIRST and consult this function
 * only for the cross-program (foreign-read) branch. See
 * `authorizeGspBootstrapRead` in `modules/gsp.ts` for the reference call site.
 */
export function hasFleetObserveCapability(auth: AuthContext): boolean {
  return Array.isArray(auth.capabilities)
    && auth.capabilities.includes(FLEET_OBSERVE_CAPABILITY);
}

/**
 * FLEET_ADMIN_CAPABILITY — RD-5 PR-D (ISO plan section 7, D-b). The literal
 * capability that decides key administration (`isKeyAdmin`). The hardcoded
 * principal list and `keys.admin` were deleted in PR-F. No role default or preset
 * contains it: it is granted by name through grant-capability.ts.
 */
export const FLEET_ADMIN_CAPABILITY = "fleet.admin";

/**
 * True iff `auth`'s own capabilities literally include `fleet.admin`.
 * Never routed through `hasCapability`: a a bare wildcard list credential must fail it.
 * Checks capabilities only; the caller binds identity via `credentialPrincipal`.
 */
export function hasFleetAdminCapability(auth: AuthContext): boolean {
  return Array.isArray(auth.capabilities)
    && auth.capabilities.includes(FLEET_ADMIN_CAPABILITY);
}
