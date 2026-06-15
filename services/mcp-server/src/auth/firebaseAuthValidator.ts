import admin from "firebase-admin";
import * as crypto from "crypto";
import type { AuthContext } from "./authValidator.js";

// Grid Portal principal map: Firebase email → { programId, userId, rateLimitTier }
// These principals have named identities in the Grid and need elevated capabilities
// (gsp.read + gsp.write) so they can ratify constitutional proposals.
const PORTAL_PRINCIPALS: Record<string, { programId: string; userId: string; rateLimitTier: string }> = {
  "christian@rezzed.ai": {
    programId: "flynn",
    userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2",
    rateLimitTier: "paid",
  },
};

/**
 * Validate a Firebase ID token and return an AuthContext.
 * Known portal principals (e.g. christian@rezzed.ai) are mapped to their
 * Grid programId so gsp_resolve reviewer checks pass correctly.
 */
export async function validateFirebaseToken(
  idToken: string
): Promise<AuthContext | null> {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);

    const encryptionKey = crypto.pbkdf2Sync(
      decoded.uid,
      "cachebash_firebase_v1",
      100000,
      32,
      "sha256"
    );

    const { getDefaultCapabilities } = await import("../middleware/capabilities.js");

    const email = decoded.email?.toLowerCase();
    const principal = email ? PORTAL_PRINCIPALS[email] : undefined;

    if (principal && decoded.email_verified === true && decoded.uid === principal.userId) {
      const pid = principal.programId as any;
      return {
        userId: principal.userId,
        apiKeyHash: `firebase:${decoded.uid}`,
        encryptionKey,
        programId: pid,
        keyProgramId: pid,
        capabilities: getDefaultCapabilities("reviewer"),
        rateLimitTier: principal.rateLimitTier,
      };
    }

    return {
      userId: decoded.uid,
      apiKeyHash: `firebase:${decoded.uid}`,
      encryptionKey,
      programId: "mobile",
      keyProgramId: "mobile",
      capabilities: getDefaultCapabilities("mobile"),
      rateLimitTier: "free",
    };
  } catch (error) {
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
