/**
 * OAuth Authorization Callback — GET /authorize/callback
 * Receives Firebase Auth result, generates authorization code, redirects to client.
 * SARK F-8: Atomic code generation via Firestore transaction.
 * SARK F-9: 32 bytes crypto.randomBytes entropy.
 */

import type http from "http";
import * as crypto from "crypto";
import admin from "firebase-admin";
import { getFirestore } from "../firebase/client.js";
import { Timestamp } from "firebase-admin/firestore";

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function errorPage(message: string): string {
  const escaped = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><head><title>Error — CacheBash</title></head><body>
<h1>Authorization Error</h1><p>${escaped}</p>
</body></html>`;
}

export async function handleOAuthCallback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  const pendingAuthId = reqUrl.searchParams.get("pending");
  const idToken = reqUrl.searchParams.get("id_token");

  if (!pendingAuthId) {
    return sendHtml(res, 400, errorPage("Missing pending authorization ID"));
  }
  if (!idToken) {
    return sendHtml(res, 400, errorPage("Missing authentication token"));
  }

  // Verify Firebase ID token
  let userId: string;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    userId = decoded.uid;
  } catch (error) {
    return sendHtml(res, 401, errorPage("Authentication failed. Please try again."));
  }

  const db = getFirestore();

  // Load pending auth
  const pendingDoc = await db.doc(`oauthPendingAuth/${pendingAuthId}`).get();
  if (!pendingDoc.exists) {
    return sendHtml(res, 400, errorPage("Authorization request not found or expired"));
  }

  const pending = pendingDoc.data()!;

  // Check expiry
  const expiresAt = pending.expiresAt?.toDate?.() || new Date(pending.expiresAt);
  if (new Date() > expiresAt) {
    return sendHtml(res, 400, errorPage("Authorization request has expired"));
  }

  // Generate authorization code (SARK F-9: 32 bytes entropy)
  const authCode = crypto.randomBytes(32).toString("hex"); // 64 hex chars
  const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
  const now = new Date();
  const codeExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  // SARK F-8: Atomic write via Firestore transaction
  try {
    await db.runTransaction(async (txn) => {
      const codeRef = db.doc(`oauthCodes/${codeHash}`);
      const existing = await txn.get(codeRef);
      if (existing.exists) {
        throw new Error("Code collision — retry");
      }

      txn.set(codeRef, {
        codeHash,
        clientId: pending.clientId,
        userId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        state: pending.state,
        scope: pending.scope,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(codeExpiresAt),
        used: false,
      });

      // Delete pending auth (consumed)
      txn.delete(db.doc(`oauthPendingAuth/${pendingAuthId}`));
    });
  } catch (error) {
    console.error("[OAuth] Code generation failed:", error);
    return sendHtml(res, 500, errorPage("Authorization failed. Please try again."));
  }

  // Redirect to client with code + state
  const redirectUrl = new URL(pending.redirectUri);
  redirectUrl.searchParams.set("code", authCode);
  redirectUrl.searchParams.set("state", pending.state);

  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}
