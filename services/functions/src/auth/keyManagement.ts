import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

const db = admin.firestore();

export const createUserKey = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  const label = data.label || "API Key";
  const userId = context.auth.uid;

  const activeKeysSnapshot = await db
    .collection("keyIndex")
    .where("userId", "==", userId)
    .where("active", "==", true)
    .get();

  if (activeKeysSnapshot.size >= 10) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Maximum of 10 active keys per user"
    );
  }

  const rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  await db.collection("keyIndex").doc(keyHash).set({
    userId,
    programId: "default",
    label,
    capabilities: [
      "dispatch.read", "dispatch.write",
      "relay.read", "relay.write",
      "pulse.read",
      "signal.read", "signal.write",
      "sprint.read",
      "metrics.read", "fleet.read",
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    active: true,
  });

  return {
    success: true,
    key: rawKey,
    keyHash,
    label,
  };
});

export const revokeUserKey = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  if (!data.keyHash) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "keyHash is required"
    );
  }

  const keyDoc = await db.collection("keyIndex").doc(data.keyHash).get();

  if (!keyDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Key not found");
  }

  const keyData = keyDoc.data();
  if (keyData?.userId !== context.auth.uid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized to revoke this key"
    );
  }

  await db.collection("keyIndex").doc(data.keyHash).update({
    active: false,
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    keyHash: data.keyHash,
  };
});

/**
 * Atomic key rotation — revoke old key + issue new key in one transaction.
 * Input: { keyHash } (proves possession of current key)
 * Auth: Firebase Auth token (proves ownership)
 * Returns: { rawKey, keyHash, label }
 */
export const rotateApiKey = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  if (!data.keyHash) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "keyHash is required"
    );
  }

  const userId = context.auth.uid;
  const oldKeyHash: string = data.keyHash;
  const oldKeyRef = db.collection("keyIndex").doc(oldKeyHash);

  // Generate new key outside transaction (crypto is deterministic per call)
  const rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
  const newKeyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const newKeyRef = db.collection("keyIndex").doc(newKeyHash);

  let label: string;

  await db.runTransaction(async (tx) => {
    const oldDoc = await tx.get(oldKeyRef);

    if (!oldDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Key not found");
    }

    const oldData = oldDoc.data()!;

    if (oldData.userId !== userId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Not authorized to rotate this key"
      );
    }

    if (!oldData.active) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Cannot rotate a revoked key"
      );
    }

    label = oldData.label || "API Key";
    const capabilities = oldData.capabilities || ["*"];
    const programId = oldData.programId || "default";

    // Revoke old key
    tx.update(oldKeyRef, {
      active: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      revokedReason: "rotation",
      rotatedTo: newKeyHash,
    });

    // Create new key with same capabilities/programId
    tx.set(newKeyRef, {
      userId,
      programId,
      label,
      capabilities,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      rotatedFrom: oldKeyHash,
    });
  });

  return {
    success: true,
    key: rawKey,
    keyHash: newKeyHash,
    label: label!,
  };
});

export const updateKeyLabel = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  if (!data.keyHash || !data.label) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "keyHash and label are required"
    );
  }

  const keyDoc = await db.collection("keyIndex").doc(data.keyHash).get();

  if (!keyDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Key not found");
  }

  const keyData = keyDoc.data();
  if (keyData?.userId !== context.auth.uid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized to update this key"
    );
  }

  await db.collection("keyIndex").doc(data.keyHash).update({
    label: data.label,
  });

  return {
    success: true,
    keyHash: data.keyHash,
    label: data.label,
  };
});
