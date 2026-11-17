import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Firestore, getFirestore as getAdminFirestore } from "firebase-admin/firestore";

let db: Firestore;

export function initializeFirebase(): void {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID || "cachebash-app";
    console.log(`[Firebase] Initializing with projectId: ${projectId}`);
    initializeApp({ projectId });
  }
  db = getAdminFirestore();
  console.log(`[Firebase] Firestore initialized`);
}

export function getFirestore(): Firestore {
  if (!db) {
    throw new Error("Firebase not initialized. Call initializeFirebase first.");
  }
  return db;
}

export function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}
