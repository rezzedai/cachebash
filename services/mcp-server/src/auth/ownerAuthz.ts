/**
 * Owner authorization for key provisioning (SARK keys.ts gate, tasks fesTTlPTC
 * + #341 re-review).
 *
 * createKey mints a NEW key under the caller's tenant with caller-chosen
 * capabilities. The capability middleware gates `keys_create_key` on
 * `keys.write` — but every "*" wildcard key satisfies that check, and every
 * Grid program defaults to ["*"]. So a leaked builder/wildcard key could mint
 * fresh admin keys for any program, turning a transient leak into durable
 * persistence (escalation).
 *
 * SARK NO-GO on the first attempt (PR #341): the original gate ALSO allowed
 * `getAllowedUids().includes(auth.userId)`. That branch was a PROD NO-OP that
 * passed EVERYTHING. The whole fleet is ONE tenant, so `auth.userId` for any
 * cb_ key is the shared TENANT uid (Flynn's allowlisted uid), NOT the calling
 * principal — authValidator stamps it, createKey copies it. Every program key
 * — including ~50 wildcards — carried that uid, so the owner branch was always
 * true and the literal keys.provision branch never ran. The unit test passed
 * only because it fabricated per-program userIds that do not exist in prod.
 *
 * The fix: drop the uid/owner branch entirely. The SOLE gate on the mint path
 * is a LITERAL `keys.provision` capability, matched by literal membership
 * (never the wildcard-expanding matcher), so "*" does NOT satisfy it and no
 * program key can self-provision. Flynn's provisioning principal is granted
 * `keys.provision` by name. A capability ceiling (see
 * `disallowedMintCapabilities`) additionally clamps minted caps to the caller's
 * own grant, so `keys.provision` can never be used to launder wildcards.
 */
import { hasCapability, type Capability } from "../middleware/capabilities.js";
import type { AuthContext } from "./authValidator.js";

/**
 * Explicit, separate key-provisioning capability. It is checked by LITERAL
 * membership below — NOT via the wildcard-expanding `hasCapability` matcher —
 * so that a "*" key does NOT satisfy it. That independence from the wildcard is
 * the entire point: it lets a principal provision keys ONLY when granted this
 * capability by name, and never as a side effect of holding "*". It is not in
 * any DEFAULT_CAPABILITIES role — it must be granted explicitly.
 */
export const KEY_PROVISION_CAPABILITY = "keys.provision";

/**
 * True iff `auth` may provision (create) API keys.
 *
 * The SOLE gate is a LITERAL `keys.provision` grant. uid is deliberately NOT
 * consulted: for cb_ keys it is the shared tenant uid (not the principal), so
 * any uid/owner allowlist check is a no-op that passes the entire fleet — the
 * exact prod no-op SARK rejected in #341. A "*" wildcard key fails the literal
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
 * A caller "holds" a capability via standard `hasCapability` semantics — it has
 * "*" or the literal cap. Consequences:
 *   • An owner key holding "*" (e.g. ["*", "keys.provision"]) may mint anything
 *     — "*" covers every requested cap. This is the deliberate owner principal.
 *   • A BOUNDED provisioner (e.g. ["dispatch.read", "keys.provision"]) may mint
 *     ONLY caps it literally holds. A request for "*" is rejected, because a
 *     bounded caller does not literally hold "*" — this is what stops
 *     keys.provision from laundering a wildcard into a freshly minted key.
 *
 * Empty array ⇒ every requested cap is within the caller's ceiling.
 */
export function disallowedMintCapabilities(
  callerCaps: string[] | undefined,
  requestedCaps: string[],
): string[] {
  if (!Array.isArray(callerCaps)) return [...requestedCaps];
  return requestedCaps.filter((cap) => !hasCapability(callerCaps, cap as Capability));
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
 * the 32 live keys hold ["*"] — including `radia`, the key the exploit was
 * proven with. Gating on it would authorize the very caller it must stop. A
 * capability check here must be LITERAL, exactly as KEY_PROVISION_CAPABILITY is.
 *
 * WHY THE PRINCIPAL IS `keyProgramId`: `auth.programId` is overridable by the
 * X-Program-Id header (BUG-006), which also RECOMPUTES `auth.capabilities` from
 * the target role. Both are attacker-controlled. `keyProgramId` is bound to the
 * authenticating credential and is never overridable — the same field
 * verifySource already relies on for Identity Sovereignty inv.6.
 */
export const KEYS_ADMIN_CAPABILITY = "keys.admin";

/**
 * Principals allowed to administer OTHER programs' keys. Deliberately tiny and
 * credential-bound: VECTOR is the fleet auditor whose boot depends on fleet
 * reads, SARK is the security auditor. ISO is deliberately NOT here — it
 * authored this fix, and an orchestrator does not need foreign-key
 * administration to do its job; granting it would be self-dealing in a security
 * change. Adding a principal is VECTOR's call, not a code-owner's convenience.
 */
export const KEY_ADMIN_PRINCIPALS: readonly string[] = ["vector", "sark"];

/**
 * The identity of the AUTHENTICATING credential. Never `auth.programId` alone —
 * that is the X-Program-Id override surface (BUG-006).
 */
export function credentialPrincipal(auth: AuthContext): string {
  return (auth.keyProgramId ?? auth.programId) as string;
}

/**
 * True iff `auth` may list or revoke keys belonging to OTHER programs.
 * Literal capability membership only — "*" does NOT satisfy it.
 */
export function isKeyAdmin(auth: AuthContext): boolean {
  if (KEY_ADMIN_PRINCIPALS.includes(credentialPrincipal(auth))) return true;
  return Array.isArray(auth.capabilities)
    && auth.capabilities.includes(KEYS_ADMIN_CAPABILITY);
}
