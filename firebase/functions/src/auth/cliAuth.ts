/**
 * CLI Auth Cloud Functions — Browser-based authentication for `cachebash init`.
 *
 * Two endpoints:
 * 1. cliAuthApprove — Called by browser after user authenticates (POST)
 * 2. cliAuthStatus — Called by CLI polling for approval (GET)
 *
 * Flow: CLI generates session token → opens browser → browser authenticates →
 * calls approve → CLI polls status → gets API key → session deleted.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { randomBytes, createHash } from "crypto";

const db = admin.firestore();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST — Called by the browser after user authenticates via Firebase Auth.
 * Creates a CLI session with an auto-generated API key.
 *
 * Body: { sessionToken: string, idToken: string }
 * The idToken is verified to get the userId.
 */
export const cliAuthApprove = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { sessionToken, idToken } = req.body;

    if (!sessionToken || !idToken) {
      res.status(400).json({ error: "Missing sessionToken or idToken" });
      return;
    }

    // Verify the Firebase ID token
    const decoded = await admin.auth().verifyIdToken(idToken);
    const userId = decoded.uid;

    // Generate API key (same pattern as keyManagement.ts)
    const rawKey = `cb_live_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // Check active key count (max 10)
    const existingKeys = await db
      .collection("keyIndex")
      .where("userId", "==", userId)
      .where("active", "==", true)
      .get();

    if (existingKeys.size >= 10) {
      res.status(400).json({ error: "Maximum 10 active API keys. Revoke an existing key first." });
      return;
    }

    // Write API key to keyIndex
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("keyIndex").doc(keyHash).set({
      userId,
      label: "CLI (auto-generated)",
      active: true,
      createdAt: now,
      createdBy: "cli-auth",
    });

    // Write the full API key doc
    await db.doc(`users/${userId}/apiKeys/${keyHash}`).set({
      keyHash,
      userId,
      label: "CLI (auto-generated)",
      active: true,
      createdAt: now,
      capabilities: ["*"],
    });

    // Store CLI session (for polling)
    await db.collection("cli_sessions").doc(sessionToken).set({
      userId,
      apiKey: rawKey,
      status: "approved",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdAt: now,
    });

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("[cliAuth] Approve failed:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
});

/**
 * GET — Called by CLI polling for approval status.
 *
 * Query: ?session={token}
 * Returns: { status: "pending" | "approved" | "expired", apiKey?, userId? }
 *
 * After first successful retrieval, deletes the session (one-time use).
 */
export const cliAuthStatus = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const sessionToken = req.query.session as string;

  if (!sessionToken) {
    res.status(400).json({ error: "Missing session parameter" });
    return;
  }

  try {
    const doc = await db.collection("cli_sessions").doc(sessionToken).get();

    if (!doc.exists) {
      res.status(200).json({ status: "pending" });
      return;
    }

    const data = doc.data()!;

    // Check expiration
    const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
    if (expiresAt < new Date()) {
      await doc.ref.delete();
      res.status(200).json({ status: "expired" });
      return;
    }

    if (data.status === "approved") {
      // One-time use — delete after retrieval
      await doc.ref.delete();
      res.status(200).json({
        status: "approved",
        apiKey: data.apiKey,
        userId: data.userId,
      });
      return;
    }

    res.status(200).json({ status: data.status || "pending" });
  } catch (err: any) {
    console.error("[cliAuth] Status check failed:", err);
    res.status(500).json({ error: "Status check failed" });
  }
});
