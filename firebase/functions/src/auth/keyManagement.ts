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
    capabilities: ["*"],
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
