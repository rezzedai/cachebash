import * as admin from "firebase-admin";

let db: admin.firestore.Firestore;

export function initializeFirebase(): void {
  if (admin.apps.length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID || "cachebash-app";
    console.log(`[Firebase] Initializing with projectId: ${projectId}`);
    admin.initializeApp({ projectId });
  }
  db = admin.firestore();
  console.log(`[Firebase] Firestore initialized`);
}

export function getFirestore(): admin.firestore.Firestore {
  if (!db) {
    throw new Error("Firebase not initialized. Call initializeFirebase first.");
  }
  return db;
}

export function serverTimestamp(): admin.firestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp();
}
