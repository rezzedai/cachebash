import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { logSuccess, logError } from "../util/structuredLog";

const db = admin.firestore();

/**
 * Triggered when a new user is created in Firebase Auth.
 * Auto-provisions tenant namespace with config, first API key, and preferences.
 */
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email, displayName, photoURL, providerData } = user;
  const provider = providerData?.[0]?.providerId || "unknown";
  const startTime = Date.now();

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

    // 7. W1.3.1: Create usage-based billing config
    await db.doc(`tenants/${uid}/_meta/billing`).set({
      monthlyBudgetUsd: null, // unlimited by default
      tokenBudgetMonthly: null, // unlimited by default
      alertThresholds: [], // no alerts by default
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logSuccess({
      function: "onUserCreate",
      uid,
      action: "create_tenant_and_firstkey",
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logError({
      function: "onUserCreate",
      uid,
      action: "create_tenant_and_firstkey",
      durationMs: Date.now() - startTime,
    }, error);
    throw error;
  }
});
