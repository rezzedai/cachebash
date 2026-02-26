import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

const db = admin.firestore();

/**
 * Triggered when a new user is created in Firebase Auth.
 * Auto-provisions tenant namespace with config, first API key, and preferences.
 */
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email, displayName, photoURL, providerData } = user;
  const provider = providerData?.[0]?.providerId || "unknown";

  try {
    // 1. Generate first API key
    const rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    // 2. Create tenant root doc
    await db.doc(`tenants/${uid}`).set({
      email: email || null,
      displayName: displayName || null,
      photoURL: photoURL || null,
      provider,
      plan: "free",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3. Create config/preferences doc
    await db.doc(`tenants/${uid}/config/preferences`).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      tourCompleted: false,
      plan: "free",
      notificationsEnabled: true,
    });

    // 4. Store API key in keyIndex (same pattern as mcp-server keys module)
    await db.doc(`keyIndex/${keyHash}`).set({
      userId: uid,
      programId: "default",
      label: "Default API Key",
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

    // 5. Store first key for one-time display in mobile app
    await db.doc(`tenants/${uid}/config/firstKey`).set({
      key: Buffer.from(rawKey).toString("base64"),
      keyHash,
      retrieved: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 6. Create billing config (free tier default)
    await db.doc(`tenants/${uid}/config/billing`).set({
      tier: "free",
      limits: {
        programs: 3,
        tasksPerMonth: 500,
        concurrentSessions: 1,
      },
      softWarnOnly: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    functions.logger.info(
      `Tenant provisioned for ${uid} (${email}), provider: ${provider}`
    );
  } catch (error) {
    functions.logger.error(
      `Failed to provision tenant for ${uid}`,
      error
    );
    throw error;
  }
});
