import admin from "firebase-admin";
import * as crypto from "crypto";
import type { AuthContext } from "./authValidator.js";

/**
 * Validate a Firebase ID token and return an AuthContext.
 * Used for mobile app authentication (OAuth 2.0 + PKCE flow).
 */
export async function validateFirebaseToken(
  idToken: string
): Promise<AuthContext | null> {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Create a deterministic encryption key from the Firebase UID
    // (needed for AuthContext compatibility)
    const encryptionKey = crypto.pbkdf2Sync(
      decoded.uid,
      "cachebash_firebase_v1",
      100000,
      32,
      "sha256"
    );

    // Phase 4: Mobile gets scoped capabilities via defaults
    const { getDefaultCapabilities } = await import("../middleware/capabilities.js");

    return {
      userId: decoded.uid,
      apiKeyHash: `firebase:${decoded.uid}`,
      encryptionKey,
      programId: "mobile",
      capabilities: getDefaultCapabilities("mobile"),
    };
  } catch (error) {
    // Token expired, invalid, or revoked
    console.error("[Auth] Firebase token validation failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Detect whether a Bearer token is a Firebase ID token or an API key.
 * Firebase tokens are JWTs (start with "eyJ").
 * API keys start with "cb_".
 */
export function isFirebaseToken(token: string): boolean {
  return token.startsWith("eyJ");
}
