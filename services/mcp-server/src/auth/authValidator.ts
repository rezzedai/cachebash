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

    // Phase 0: Auth Mode logic
    const AUTH_MODE = process.env.AUTH_MODE || 'hybrid';

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

    return {
      userId,
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
