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
  capabilities: string[];
  /** OAuth granted scopes — only present for OAuth tokens */
  oauthScopes?: string[];
  /** Rate limit tier — resolved from API key doc, defaults to "free" */
  rateLimitTier: string;
}

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function validateApiKey(
  apiKey: string
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

    // Determine programId — v1 keys won't have it, default to "legacy"
    const programId: ValidProgramId = data.programId || "legacy";

    // Update lastUsedAt (fire-and-forget — don't block auth)
    db.doc(`keyIndex/${keyHash}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});

    // Load capabilities from key doc, falling back to defaults for the program
    const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
    const capabilities: string[] = data.capabilities && data.capabilities.length > 0
      ? data.capabilities
      : getDefaultCapabilities(programId);

    return {
      userId: data.userId,
      apiKeyHash: keyHash,
      encryptionKey: deriveEncryptionKey(apiKey),
      programId,
      capabilities,
      rateLimitTier: data.rateLimitTier || "free",
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
