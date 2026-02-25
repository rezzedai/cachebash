/**
 * OAuth Token Endpoint — POST /token
 * Handles authorization_code and refresh_token grants.
 * SARK F-8: Atomic single-use code via Firestore transaction.
 * SARK F-10: Generic invalid_grant errors only — no information leakage.
 */

import type http from "http";
import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { Timestamp } from "firebase-admin/firestore";

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

function generateToken(prefix: string): string {
  return prefix + crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Base64url encode a buffer */
function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Verify PKCE: SHA256(code_verifier) === code_challenge (base64url) */
function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64urlEncode(hash) === codeChallenge;
}

export async function handleOAuthToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    return handleAuthorizationCodeGrant(params, res);
  }
  if (grantType === "refresh_token") {
    return handleRefreshTokenGrant(params, res);
  }

  return sendJson(res, 400, { error: "unsupported_grant_type", error_description: "Supported: authorization_code, refresh_token" });
}

async function handleAuthorizationCodeGrant(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const clientId = params.get("client_id");
  const codeVerifier = params.get("code_verifier");

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return sendJson(res, 400, { error: "invalid_request", error_description: "Missing required parameters" });
  }

  const codeHash = hashToken(code);
  const db = getFirestore();

  try {
    // SARK F-8: Atomic single-use check via transaction
    const result = await db.runTransaction(async (txn) => {
      const codeRef = db.doc(`oauthCodes/${codeHash}`);
      const codeDoc = await txn.get(codeRef);

      if (!codeDoc.exists) return null;
      const codeData = codeDoc.data()!;

      // Single-use check
      if (codeData.used) return null;

      // Verify expiry
      const expiresAt = codeData.expiresAt?.toDate?.() || new Date(codeData.expiresAt);
      if (new Date() > expiresAt) return null;

      // Verify client_id
      if (codeData.clientId !== clientId) return null;

      // Verify redirect_uri
      if (codeData.redirectUri !== redirectUri) return null;

      // PKCE verification
      if (!verifyPkce(codeVerifier, codeData.codeChallenge)) return null;

      // Mark as used atomically
      txn.update(codeRef, { used: true });

      return codeData;
    });

    if (!result) {
      // SARK F-10: Generic error — no detail on why it failed
      return sendJson(res, 400, { error: "invalid_grant" });
    }

    // Generate tokens
    const accessToken = generateToken("cbo_");
    const refreshToken = generateToken("cbr_");
    const accessHash = hashToken(accessToken);
    const refreshHash = hashToken(refreshToken);
    const familyId = crypto.randomUUID();
    const now = new Date();

    // Store access token (1 hour TTL)
    const accessExpiresAt = new Date(now.getTime() + 3600 * 1000);
    await db.doc(`oauthTokens/${accessHash}`).set({
      tokenHash: accessHash,
      tokenPrefix: "cbo_",
      type: "access",
      clientId,
      userId: result.userId,
      scope: result.scope,
      programId: "oauth",
      familyId,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(accessExpiresAt),
      revokedAt: null,
      active: true,
      parentRefreshTokenHash: null,
    });

    // Store refresh token (30 day TTL)
    const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    await db.doc(`oauthTokens/${refreshHash}`).set({
      tokenHash: refreshHash,
      tokenPrefix: "cbr_",
      type: "refresh",
      clientId,
      userId: result.userId,
      scope: result.scope,
      programId: "oauth",
      familyId,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(refreshExpiresAt),
      revokedAt: null,
      active: true,
      parentRefreshTokenHash: null,
    });

    return sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: result.scope,
    });
  } catch (error) {
    console.error("[OAuth] Token exchange failed:", error);
    return sendJson(res, 400, { error: "invalid_grant" });
  }
}

async function handleRefreshTokenGrant(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
  const refreshToken = params.get("refresh_token");
  const clientId = params.get("client_id");

  if (!refreshToken || !clientId) {
    return sendJson(res, 400, { error: "invalid_request", error_description: "Missing required parameters" });
  }

  // SARK F-6: Prefix check before Firestore lookup
  if (!refreshToken.startsWith("cbr_")) {
    return sendJson(res, 400, { error: "invalid_grant" });
  }

  const tokenHash = hashToken(refreshToken);
  const db = getFirestore();

  try {
    const tokenDoc = await db.doc(`oauthTokens/${tokenHash}`).get();
    if (!tokenDoc.exists) {
      return sendJson(res, 400, { error: "invalid_grant" });
    }

    const tokenData = tokenDoc.data()!;

    // SARK F-4: Replay detection — if token already revoked, revoke entire family
    if (!tokenData.active || tokenData.revokedAt) {
      await revokeFamilyTokens(db, tokenData.familyId);
      return sendJson(res, 400, { error: "invalid_grant" });
    }

    // Verify type, expiry, client
    if (tokenData.type !== "refresh") return sendJson(res, 400, { error: "invalid_grant" });
    const expiresAt = tokenData.expiresAt?.toDate?.() || new Date(tokenData.expiresAt);
    if (new Date() > expiresAt) return sendJson(res, 400, { error: "invalid_grant" });
    if (tokenData.clientId !== clientId) return sendJson(res, 400, { error: "invalid_grant" });

    // Revoke the used refresh token (rotation)
    const now = new Date();
    await db.doc(`oauthTokens/${tokenHash}`).update({
      active: false,
      revokedAt: Timestamp.fromDate(now),
    });

    // Generate new token pair
    const newAccessToken = generateToken("cbo_");
    const newRefreshToken = generateToken("cbr_");
    const newAccessHash = hashToken(newAccessToken);
    const newRefreshHash = hashToken(newRefreshToken);

    // Store new access token
    const accessExpiresAt = new Date(now.getTime() + 3600 * 1000);
    await db.doc(`oauthTokens/${newAccessHash}`).set({
      tokenHash: newAccessHash,
      tokenPrefix: "cbo_",
      type: "access",
      clientId,
      userId: tokenData.userId,
      scope: tokenData.scope,
      programId: "oauth",
      familyId: tokenData.familyId,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(accessExpiresAt),
      revokedAt: null,
      active: true,
      parentRefreshTokenHash: tokenHash,
    });

    // Store new refresh token (inherits familyId)
    const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    await db.doc(`oauthTokens/${newRefreshHash}`).set({
      tokenHash: newRefreshHash,
      tokenPrefix: "cbr_",
      type: "refresh",
      clientId,
      userId: tokenData.userId,
      scope: tokenData.scope,
      programId: "oauth",
      familyId: tokenData.familyId,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(refreshExpiresAt),
      revokedAt: null,
      active: true,
      parentRefreshTokenHash: tokenHash,
    });

    return sendJson(res, 200, {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: tokenData.scope,
    });
  } catch (error) {
    console.error("[OAuth] Refresh token exchange failed:", error);
    return sendJson(res, 400, { error: "invalid_grant" });
  }
}

/** Revoke all tokens in a family (SARK F-4: replay attack response) */
async function revokeFamilyTokens(db: FirebaseFirestore.Firestore, familyId: string): Promise<void> {
  try {
    const snapshot = await db.collection("oauthTokens")
      .where("familyId", "==", familyId)
      .where("active", "==", true)
      .get();

    const batch = db.batch();
    const now = Timestamp.fromDate(new Date());
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { active: false, revokedAt: now });
    }
    await batch.commit();
    console.warn(`[OAuth] Family revocation: revoked ${snapshot.size} tokens in family ${familyId}`);
  } catch (error) {
    console.error("[OAuth] Family revocation failed:", error);
  }
}
