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
