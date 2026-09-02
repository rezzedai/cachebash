import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { deriveEncryptionKey } from "../encryption/crypto.js";
import { FieldValue } from "firebase-admin/firestore";
import type { ValidProgramId } from "../config/programs.js";

export interface AuthContext {
  userId: string;
  apiKeyHash: string;
  encryptionKey: Buffer;
  programId: ValidProgramId;
  /** The programId bound to the AUTHENTICATING credential (cb_ key, Firebase token, OAuth token).
   * Never overridable by X-Program-Id. Used by verifySource to enforce Identity Sovereignty inv.6:
   * claimed source must match the credential's own identity.
   * Always set by production auth validators. Optional only for test backward compat. */
  keyProgramId?: ValidProgramId;
  capabilities: string[];
  /** OAuth granted scopes — only present for OAuth tokens */
  oauthScopes?: string[];
  /** Rate limit tier — resolved from API key doc, defaults to "free" */
  rateLimitTier: string;
  /** WS-2: seat identifier for wingman-tier seat-enrolled keys. Populated ONLY from
   * the validated key doc's own seatId field — never from a request header. Undefined
   * for non-seat keys. */
  seatId?: string;
}

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function validateApiKey(
  apiKey: string,
  programIdOverride?: string
): Promise<AuthContext | null> {
  const keyHash = hashApiKey(apiKey);
  const db = getFirestore();

  try {
    const keyDoc = await db.doc(`keyIndex/${keyHash}`).get();
    if (!keyDoc.exists) return null;

    const data = keyDoc.data();
    if (!data?.userId) return null;

    // Phase 2: Check active flag (default true for v1 keys without the field)
    if (data.active === false) return null;

    // Phase 2: Check revocation
    if (data.revokedAt) return null;

    // Grace window: rotated keys stay valid until expiresAt
    if (data.expiresAt) {
      const expiresAt = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
      if (expiresAt < new Date()) return null;
    }

    const userId = data.userId;

    // The key's canonical identity — never overridable. Used for source enforcement (BUG-005).
    const keyProgramId: ValidProgramId = (data.programId || "legacy") as ValidProgramId;

    // Phase 0: Auth Mode logic — fail-secure default: key_identity ignores X-Program-Id for authz
    const AUTH_MODE = process.env.AUTH_MODE || 'key_identity';

    // gsp_identity mode: reject cb_ keys without X-Program-Id header
    if (AUTH_MODE === 'gsp_identity' && apiKey.startsWith('cb_') && !programIdOverride) {
      console.warn('[Auth] gsp_identity mode: cb_ key requires X-Program-Id header');
      return null;
    }

    // key_identity mode: ignore programIdOverride entirely
    let programId: ValidProgramId;
    let capabilities: string[];

    if (AUTH_MODE === 'key_identity') {
      // Always use key's programId
      programId = data.programId || "legacy";
      const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
      capabilities = data.capabilities && data.capabilities.length > 0
        ? data.capabilities
        : getDefaultCapabilities(programId);
    } else {
      // hybrid mode (default) or gsp_identity mode
      if (programIdOverride) {
        // Validate the program exists
        const programDoc = await db.doc(`tenants/${userId}/programs/${programIdOverride}`).get();
        if (!programDoc.exists) {
          console.warn(`[Auth] Program override ${programIdOverride} not found for user ${userId}`);
          return null;
        }

        const programData = programDoc.data();
        if (programData?.active === false) {
          console.warn(`[Auth] Program override ${programIdOverride} is inactive`);
          return null;
        }

        programId = programIdOverride as ValidProgramId;
        
        // Look up capabilities via the program's role
        const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
        const role = programData?.role || 'worker';
        capabilities = getDefaultCapabilities(role);
      } else {
        // No override: fall back to key's programId (backward compatible)
        programId = data.programId || "legacy";
        const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
        capabilities = data.capabilities && data.capabilities.length > 0
          ? data.capabilities
          : getDefaultCapabilities(programId);
      }
    }

    // Update lastUsedAt (fire-and-forget — don't block auth)
    db.doc(`keyIndex/${keyHash}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});

    // WS-2: seatId comes ONLY from the validated key doc — never from a request header.
    const seatId: string | undefined = typeof data.seatId === "string" ? data.seatId : undefined;

    return {
      userId,
      apiKeyHash: keyHash,
      encryptionKey: deriveEncryptionKey(apiKey),
      programId,
      keyProgramId,
      capabilities,
      rateLimitTier: data.rateLimitTier || "free",
      ...(seatId ? { seatId } : {}),
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return null;
  }
}

export { hashApiKey };

/**
 * A13 (PDR-cachebash-authz-chokepoint, ISO plan §1.1 / §4) — assert AUTH_MODE
 * explicitly at boot rather than trust the `|| 'key_identity'` fallback above
 * silently.
 *
 * That fallback is fail-secure, but it is a DEFAULT, not a pinned invariant:
 * as of this plan, AUTH_MODE is set on NO env var on the serving revision.
 * Every R4a decision in `modules/gsp.ts` (the new `fleet.observe` gate on
 * `gsp_bootstrap`) is only safe because `key_identity` mode ignores
 * `X-Program-Id` entirely — under `hybrid`/`gsp_identity` mode,
 * `auth.capabilities` gets RECOMPUTED from the header-named program's role
 * (BUG-006), so a capability check divorced from that assumption is
 * forgeable. One env var, set with no code change and no test noticing,
 * would silently revert that assumption.
 *
 * Deliberately logs LOUD and does NOT `process.exit` — AUTH_MODE is not yet
 * pinned as an explicit Cloud Run env var on the serving revision, and a hard
 * boot-crash here would brick request-serving for the entire fleet (a
 * materially worse failure than the misconfiguration this assertion detects).
 * Escalated to BASHER/ISO: tighten this to a hard boot failure once
 * `AUTH_MODE=key_identity` is confirmed set explicitly on the serving Cloud
 * Run revision, coordinated with the PR-3 deploy.
 */
export function assertAuthModeAtBoot(
  env: NodeJS.ProcessEnv = process.env
): { ok: boolean; mode: string | undefined } {
  const mode = env.AUTH_MODE;
  const ok = mode === "key_identity";
  if (!ok) {
    console.error(
      `[BOOT][SECURITY] AUTH_MODE is ${mode === undefined ? "UNSET" : JSON.stringify(mode)}, ` +
      `not explicitly pinned to "key_identity". This service is relying on authValidator.ts's ` +
      `"|| 'key_identity'" fallback default, not an asserted invariant. If AUTH_MODE is ever set ` +
      `to "hybrid" or "gsp_identity", auth.capabilities becomes recomputable from the forgeable ` +
      `X-Program-Id header (BUG-006) — the exact path the gsp_bootstrap fleet.observe gate (R4a) ` +
      `assumes cannot happen. Set AUTH_MODE=key_identity explicitly on this service.`
    );
  } else {
    console.log('[BOOT] AUTH_MODE asserted: "key_identity" (explicit env var, not inherited from fallback default).');
  }
  return { ok, mode };
}

import { validateFirebaseToken, isFirebaseToken } from "./firebaseAuthValidator.js";
import { validateOAuthToken, isOAuthToken } from "./oauthTokenValidator.js";
import { resolveTenant } from "./tenant-resolver.js";

/**
 * Combined auth validator — detection order:
 * 1. Firebase JWT (eyJ prefix)
 * 2. API key (cb_ prefix)
 * 3. OAuth access token (cbo_ prefix)
 * Unknown prefixes rejected immediately (SARK F-6).
 *
 * After auth succeeds, tenant resolution maps alternate UIDs to the
 * canonical tenant ID so all downstream Firestore ops use a single path.
 */
export async function validateAuth(token: string, programIdOverride?: string): Promise<AuthContext | null> {
  let auth: AuthContext | null = null;

  if (isFirebaseToken(token)) {
    auth = await validateFirebaseToken(token);
  } else if (token.startsWith("cb_")) {
    auth = await validateApiKey(token, programIdOverride);
  } else if (isOAuthToken(token)) {
    auth = await validateOAuthToken(token);
  }

  if (!auth) return null;

  // Resolve tenant: map alternate UIDs to canonical tenant ID
  try {
    const db = getFirestore();
    const resolution = await resolveTenant(auth.userId, db);
    if (!resolution.canonical) {
      auth.userId = resolution.tenantId;
    }
  } catch {
    // Tenant resolution failure must not block auth — pass through raw UID
  }

  return auth;
}
