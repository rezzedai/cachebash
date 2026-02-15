import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

/**
 * Triggered when a new user is created in Firebase Auth.
 * Creates the initial user document in Firestore.
 */
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email } = user;

  try {
    await db.doc(`users/${uid}`).set({
      email: email || null,
      apiKeyHash: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    functions.logger.info(`Created user document for ${uid}`);
  } catch (error) {
    functions.logger.error(`Failed to create user document for ${uid}`, error);
    throw error;
  }
});
