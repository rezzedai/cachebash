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
    const keyDoc = await db.doc(`apiKeys/${keyHash}`).get();
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
    db.doc(`apiKeys/${keyHash}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});

    return {
      userId: data.userId,
      apiKeyHash: keyHash,
      encryptionKey: deriveEncryptionKey(apiKey),
      programId,
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return null;
  }
}

export { hashApiKey };
