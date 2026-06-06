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

/**
 * Flynn-only principal allowlist (SARK gate, task s0QMEUOc).
 * verifyIdToken proves the token is signed by Firebase for cachebash-app
 * (aud/iss bound) — but says nothing about WHO signed in. Without this gate
 * any Google/GitHub account could complete consent and claim SCALAR's
 * operational-write capabilities.
 *
 * A principal is allowed iff:
 *   - their uid is explicitly allowlisted (stable, provider-independent), OR
 *   - their email is allowlisted AND email_verified === true (GitHub tokens
 *     can carry unverified emails — those are rejected).
 * Configurable via OAUTH_ALLOWED_EMAILS / OAUTH_ALLOWED_UIDS (comma-separated)
 * so the list is maintainable without a code change.
 */
const DEFAULT_ALLOWED_EMAILS = ["christianbourlier@gmail.com", "christian@rezzed.ai"];
const DEFAULT_ALLOWED_UIDS = ["7viFKVtl5lgzguhFoZlnYYrqeDG2"]; // christian@rezzed.ai

function parseListEnv(value: string | undefined, fallback: string[], lowercase: boolean): string[] {
  if (!value || !value.trim()) return fallback;
  return value
    .split(",")
    .map((s) => (lowercase ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
}

export function getAllowedEmails(): string[] {
  return parseListEnv(process.env.OAUTH_ALLOWED_EMAILS, DEFAULT_ALLOWED_EMAILS, true);
}

export function getAllowedUids(): string[] {
  return parseListEnv(process.env.OAUTH_ALLOWED_UIDS, DEFAULT_ALLOWED_UIDS, false);
}

export function isAllowedPrincipal(p: { uid: string; email?: string; email_verified?: boolean }): boolean {
  if (getAllowedUids().includes(p.uid)) return true;
  if (p.email && p.email_verified === true && getAllowedEmails().includes(p.email.toLowerCase())) return true;
  return false;
}

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
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    return sendHtml(res, 401, errorPage("Authentication failed. Please try again."));
  }
  const userId = decoded.uid;

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

  // Flynn-only allowlist: deny non-allowlisted principals BEFORE any
  // authorization code exists. The pending auth is consumed (deleted) and the
  // client gets a standard access_denied redirect — redirectUri was validated
  // against the registered client at /authorize, so this redirect is safe.
  if (!isAllowedPrincipal(decoded)) {
    console.warn(
      `[OAuth] Denied non-allowlisted principal uid=${decoded.uid} email=${decoded.email || "none"} verified=${decoded.email_verified === true}`
    );
    await db.doc(`oauthPendingAuth/${pendingAuthId}`).delete();
    const denyUrl = new URL(pending.redirectUri);
    denyUrl.searchParams.set("error", "access_denied");
    denyUrl.searchParams.set("error_description", "This account is not authorized for this server");
    denyUrl.searchParams.set("state", pending.state);
    res.writeHead(302, { Location: denyUrl.toString() });
    res.end();
    return;
  }

  // Generate authorization code (SARK F-9: 32 bytes entropy)
  const authCode = crypto.randomBytes(32).toString("hex"); // 64 hex chars
  const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
  const now = new Date();
  const codeExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  // SARK F-8: Atomic write via Firestore transaction
  try {
    await db.runTransaction(async (txn: any) => {
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
        // Program identity selected on the consent screen (allowlist-validated there)
        programId: pending.programId || "oauth",
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
