/**
 * OAuth Token Validator — validates cbo_ access tokens.
 * Lookup by SHA-256 hash in oauthTokens collection.
 */

import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import type { AuthContext } from "./authValidator.js";

export function isOAuthToken(token: string): boolean {
  return token.startsWith("cbo_");
}

export async function validateOAuthToken(token: string): Promise<AuthContext | null> {
  // SARK F-6: Prefix check before any Firestore lookup
  if (!token.startsWith("cbo_")) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const db = getFirestore();

  try {
    const tokenDoc = await db.doc(`oauthTokens/${tokenHash}`).get();
    if (!tokenDoc.exists) return null;

    const data = tokenDoc.data();
    if (!data) return null;

    // Verify token is valid
    if (data.active !== true) return null;
    if (data.type !== "access") return null;
    if (data.revokedAt) return null;

    // Check expiry
    const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;
    if (expiresAt && new Date(expiresAt) <= new Date()) return null;

    // Derive encryption key from userId (SARK F-7)
    const encryptionKey = crypto.pbkdf2Sync(
      data.userId,
      "cachebash_oauth_v1",
      100000,
      32,
      "sha256"
    );

    // Fire-and-forget: update lastUsedAt
    db.doc(`oauthTokens/${tokenHash}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});

    // Load capabilities
    const { getDefaultCapabilities } = await import("../middleware/capabilities.js");

    // Pass granted scopes through capabilities for scope enforcement
    const grantedScopes = data.grantedScopes || (data.scope ? data.scope.split(" ") : ["mcp:full"]);

    return {
      userId: data.userId,
      apiKeyHash: `oauth:${tokenHash}`,
      encryptionKey,
      programId: "oauth",
      capabilities: getDefaultCapabilities("oauth"),
      oauthScopes: grantedScopes,
    };
  } catch (error) {
    console.error("[Auth] OAuth token validation failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
