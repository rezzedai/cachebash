import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { deriveEncryptionKey } from "../encryption/crypto.js";

export interface AuthContext {
  userId: string;
  apiKeyHash: string;
  encryptionKey: Buffer;
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

    const userDoc = await db.doc(`users/${data.userId}`).get();
    if (!userDoc.exists) return null;

    const userData = userDoc.data();
    const storedHash = userData?.apiKeyHash;
    if (
      !storedHash ||
      storedHash.length !== keyHash.length ||
      !crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(keyHash))
    ) {
      return null;
    }

    return {
      userId: data.userId,
      apiKeyHash: keyHash,
      encryptionKey: deriveEncryptionKey(apiKey),
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return null;
  }
}
