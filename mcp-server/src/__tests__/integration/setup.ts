/**
 * Integration Test Setup Utilities
 *
 * Provides shared utilities for integration tests running against Firestore emulator.
 * Assumes FIRESTORE_EMULATOR_HOST=localhost:8080 is set in environment.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
const PROJECT_ID = "cachebash-app";

let firestoreInstance: admin.firestore.Firestore | null = null;

/**
 * Get a Firestore instance pointed at the emulator
 */
export function getTestFirestore(): admin.firestore.Firestore {
  if (!firestoreInstance) {
    // Initialize Firebase Admin with emulator settings
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }

    firestoreInstance = admin.firestore();

    // Set emulator host
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      console.log(`[Integration Test] Using Firestore emulator: ${EMULATOR_HOST}`);
    } else {
      console.warn(`[Integration Test] FIRESTORE_EMULATOR_HOST not set! Defaulting to: ${EMULATOR_HOST}`);
      process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
    }
  }

  return firestoreInstance;
}

/**
 * Clear all Firestore data using the emulator REST API
 */
export async function clearFirestoreData(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  try {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`Failed to clear Firestore: ${response.statusText}`);
    }
  } catch (error) {
    console.error("[Integration Test] Failed to clear Firestore data:", error);
    throw error;
  }
}

/**
 * Create a test user with API key in the emulator
 */
export async function seedTestUser(userId: string): Promise<{
  userId: string;
  apiKeyHash: string;
  apiKey: string;
  encryptionKey: Buffer;
}> {
  const db = getTestFirestore();

  // Generate a test API key
  const apiKey = `test-key-${crypto.randomBytes(16).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  // Generate encryption key (32 bytes for AES-256)
  const encryptionKey = crypto.randomBytes(32);

  // Create user document
  await db.collection("users").doc(userId).set({
    email: `${userId}@test.local`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Create API key document
  await db.collection(`users/${userId}/apiKeys`).doc(apiKeyHash).set({
    programId: "iso",
    label: "Test Key",
    keyHash: apiKeyHash,
    encryptionKey: encryptionKey.toString("base64"),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    revoked: false,
  });

  return {
    userId,
    apiKeyHash,
    apiKey,
    encryptionKey,
  };
}

/**
 * Bulk insert test documents into a collection
 */
export async function seedTestData(
  userId: string,
  collection: string,
  docs: Array<{ id: string; data: any }>
): Promise<void> {
  const db = getTestFirestore();
  const batch = db.batch();

  for (const doc of docs) {
    const ref = db.collection(`users/${userId}/${collection}`).doc(doc.id);
    batch.set(ref, doc.data);
  }

  await batch.commit();
}
