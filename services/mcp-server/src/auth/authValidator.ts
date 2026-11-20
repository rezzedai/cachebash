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
   * Used by verifySource to enforce Identity Sovereignty inv.6:
   * claimed source must match the credential's own identity.
   * Set by every auth validator. */
  keyProgramId: ValidProgramId;
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

/** Throttle for the keyIndex.lastUsedAt write (see validateApiKey). */
export const LAST_USED_WRITE_INTERVAL_MS = 60 * 60_000;

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function validateApiKey(apiKey: string): Promise<AuthContext | null> {
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

    // The key's canonical identity. A key document with no programId is denied:
    // no principal is minted from a missing field.
    if (typeof data.programId !== "string" || data.programId === "") {
      console.warn("[Auth] keyIndex document has no programId; denying");
      return null;
    }
    const programId = data.programId as ValidProgramId;
    const keyProgramId: ValidProgramId = programId;

    const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
    const capabilities: string[] = data.capabilities && data.capabilities.length > 0
      ? data.capabilities
      : getDefaultCapabilities(programId);

    // Update lastUsedAt (fire-and-forget — don't block auth), at most once an
    // hour per key (COST PDR 2c). Its only reader (index.ts) asks "used in the last 7
    // days", and writing it on every call made it one Firestore write per
    // request for the fleet's busiest caller. Uses the doc already read above.
    const lastUsedMs: number = data.lastUsedAt?.toMillis?.() ?? 0;
    if (Date.now() - lastUsedMs >= LAST_USED_WRITE_INTERVAL_MS) {
      db.doc(`keyIndex/${keyHash}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});
    }

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
export async function validateAuth(token: string): Promise<AuthContext | null> {
  let auth: AuthContext | null = null;

  if (isFirebaseToken(token)) {
    auth = await validateFirebaseToken(token);
  } else if (token.startsWith("cb_")) {
    auth = await validateApiKey(token);
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
