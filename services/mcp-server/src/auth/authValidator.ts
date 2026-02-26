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
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return null;
  }
}

export { hashApiKey };

import { validateFirebaseToken, isFirebaseToken } from "./firebaseAuthValidator.js";
import { validateOAuthToken, isOAuthToken } from "./oauthTokenValidator.js";

/**
 * Combined auth validator — detection order:
 * 1. Firebase JWT (eyJ prefix)
 * 2. API key (cb_ prefix)
 * 3. OAuth access token (cbo_ prefix)
 * Unknown prefixes rejected immediately (SARK F-6).
 */
export async function validateAuth(token: string): Promise<AuthContext | null> {
  if (isFirebaseToken(token)) {
    return validateFirebaseToken(token);
  }
  if (token.startsWith("cb_")) {
    return validateApiKey(token);
  }
  if (isOAuthToken(token)) {
    return validateOAuthToken(token);
  }
  // Unknown prefix — reject immediately, no database round-trip
  return null;
}
