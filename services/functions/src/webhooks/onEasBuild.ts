/**
 * EAS Build Webhook Handler
 *
 * Receives POST from Expo EAS on build status change.
 * On error: creates high-priority task for ISO + sends alert to Flynn.
 * On success: sends success alert to Flynn.
 *
 * Signature: expo-signature header, HMAC-SHA1 of body with webhook secret.
 *
 * Setup:
 *   firebase functions:config:set eas.webhook_secret="<secret>"
 *   eas webhook:create --url <function_url> --event BUILD --secret <secret>
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

interface EasBuildPayload {
  id: string;
  accountName: string;
  projectName: string;
  buildDetailsPageUrl: string;
  platform: "android" | "ios";
  status: "finished" | "errored" | "canceled";
  artifacts?: {
    buildUrl?: string;
  };
  metadata?: {
    appVersion?: string;
    appBuildVersion?: string;
    sdkVersion?: string;
    gitCommitHash?: string;
    gitCommitMessage?: string;
  };
  error?: {
    errorCode?: string;
    message?: string;
  };
  createdAt: string;
  completedAt: string;
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(body);
  const expected = `sha1=${hmac.digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const onEasBuild = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Verify webhook signature
  const secret = functions.config().eas?.webhook_secret;
  if (!secret) {
    console.error("[EAS Webhook] No webhook secret configured");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const signature = req.headers["expo-signature"] as string;
  if (!signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as EasBuildPayload;
  const buildNum = payload.metadata?.appBuildVersion || "?";
  const platform = payload.platform?.toUpperCase() || "?";
  const version = payload.metadata?.appVersion || "?";
  const commit = payload.metadata?.gitCommitHash?.substring(0, 7) || "?";

  console.log(`[EAS Webhook] Build #${buildNum} ${platform} — ${payload.status}`);

  // Find the tenant (single-tenant: use first user)
  const usersSnap = await admin.firestore().collection("tenants").limit(1).get();
  if (usersSnap.empty) {
    console.error("[EAS Webhook] No tenant found");
    res.status(200).json({ received: true });
    return;
  }
  const tenantId = usersSnap.docs[0].id;
  const basePath = `tenants/${tenantId}`;

  if (payload.status === "errored") {
    const errorMsg = payload.error?.message || "Unknown error";

    // Create high-priority task for ISO
    await admin.firestore().collection(`${basePath}/tasks`).add({
      schemaVersion: "2.2",
      type: "task",
      title: `EAS Build #${buildNum} FAILED (${platform}): ${errorMsg}`,
      instructions: `Build #${buildNum} errored.\n\nPlatform: ${platform}\nVersion: ${version}\nCommit: ${commit}\nError: ${errorMsg}\nDetails: ${payload.buildDetailsPageUrl}`,
      preview: `EAS Build #${buildNum} FAILED (${platform})`,
      source: "system",
      target: "iso",
      priority: "high",
      action: "interrupt",
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      encrypted: false,
      archived: false,
    });

    // Send alert to Flynn's device
    await admin.firestore().collection(`${basePath}/relay`).add({
      schemaVersion: "2.2",
      source: "system",
      target: "user",
      message_type: "STATUS",
      payload: `Build #${buildNum} (${platform}) FAILED: ${errorMsg}\n${payload.buildDetailsPageUrl}`,
      priority: "high",
      action: "interrupt",
      status: "pending",
      ttl: 86400,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400 * 1000),
      alertType: "error",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else if (payload.status === "finished") {
    // Send success alert
    await admin.firestore().collection(`${basePath}/relay`).add({
      schemaVersion: "2.2",
      source: "system",
      target: "user",
      message_type: "STATUS",
      payload: `Build #${buildNum} (${platform} v${version}) succeeded! Ready for TestFlight submit.\n${payload.buildDetailsPageUrl}`,
      priority: "normal",
      action: "queue",
      status: "pending",
      ttl: 86400,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400 * 1000),
      alertType: "success",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else if (payload.status === "canceled") {
    // Log only — no alert for cancellations
    console.log(`[EAS Webhook] Build #${buildNum} canceled`);
  }

  res.status(200).json({ received: true, status: payload.status });
});
