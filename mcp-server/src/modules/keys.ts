/**
 * Key Management — Create, revoke, and list per-program API keys.
 *
 * Only Flynn's userId can manage keys (Phase 2 hardcode).
 * Phase 4: Scoped capabilities per key.
 */

import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";
import type { AuthContext } from "../auth/apiKeyValidator.js";
import { isValidProgram } from "../config/programs.js";
import type { ApiKeyDoc } from "../types/apiKey.js";

function generateApiKey(): string {
  return `cb_${crypto.randomBytes(32).toString("hex")}`;
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Create a new API key bound to a programId.
 * Returns the raw key — only time it's visible.
 */
export async function createKeyHandler(auth: AuthContext, args: any) {
  const { programId, label } = args;

  if (!programId) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "programId is required" }) }],
    };
  }

  if (!isValidProgram(programId)) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: `Unknown program: ${programId}` }) }],
    };
  }

  if (!label) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "label is required" }) }],
    };
  }

  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);
  const db = getFirestore();

  // Phase 4: Accept scoped capabilities, default to program defaults
  const { getDefaultCapabilities } = await import("../middleware/capabilities.js");
  const requestedCapabilities: string[] = args.capabilities && Array.isArray(args.capabilities) && args.capabilities.length > 0
    ? args.capabilities
    : getDefaultCapabilities(programId);

  const keyDoc: Omit<ApiKeyDoc, "createdAt" | "lastUsedAt"> & { createdAt: any } = {
    userId: auth.userId,
    programId,
    label,
    capabilities: requestedCapabilities,
    createdAt: FieldValue.serverTimestamp(),
    active: true,
  };

  await db.doc(`apiKeys/${keyHash}`).set(keyDoc);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        key: rawKey,
        keyHash,
        programId,
        label,
        capabilities: requestedCapabilities,
        message: "Store this key securely. It will not be shown again.",
      }),
    }],
  };
}

/**
 * Revoke an API key by its hash. Soft revoke — doc stays for audit.
 */
export async function revokeKeyHandler(auth: AuthContext, args: any) {
  const { keyHash } = args;

  if (!keyHash) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "keyHash is required" }) }],
    };
  }

  const db = getFirestore();
  const keyRef = db.doc(`apiKeys/${keyHash}`);
  const keyDoc = await keyRef.get();

  if (!keyDoc.exists) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "Key not found" }) }],
    };
  }

  const data = keyDoc.data();
  if (data?.userId !== auth.userId) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "Key belongs to a different user" }) }],
    };
  }

  await keyRef.update({
    active: false,
    revokedAt: FieldValue.serverTimestamp(),
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        keyHash,
        message: "Key revoked. It will no longer authenticate.",
      }),
    }],
  };
}

/**
 * List all API keys for the authenticated user.
 * Returns metadata only — never raw keys.
 */
export async function listKeysHandler(auth: AuthContext, args: any) {
  const db = getFirestore();
  const { includeRevoked } = args || {};

  // Query all apiKeys docs for this user
  let query = db.collection("apiKeys").where("userId", "==", auth.userId);

  const snapshot = await query.get();

  const keys = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        keyHash: doc.id,
        programId: data.programId || "legacy",
        label: data.label || "Unnamed",
        capabilities: data.capabilities || ["*"],
        active: data.active !== false,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString() || null,
        revokedAt: data.revokedAt?.toDate?.()?.toISOString() || null,
      };
    })
    .filter((key) => includeRevoked || key.active);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        count: keys.length,
        keys,
      }),
    }],
  };
}
