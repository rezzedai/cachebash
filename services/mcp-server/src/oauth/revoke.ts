/**
 * OAuth Token Revocation — POST /revoke
 * RFC 7009: Always returns 200 (even if token not found).
 * SARK F-4: Refresh token revocation triggers family-wide revocation.
 */

import type http from "http";
import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { Timestamp } from "firebase-admin/firestore";

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

export async function handleOAuthRevoke(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const token = params.get("token");

  if (!token) {
    // RFC 7009: always 200
    return sendJson(res, 200, {});
  }

  // Detect prefix
  const isAccess = token.startsWith("cbo_");
  const isRefresh = token.startsWith("cbr_");
  if (!isAccess && !isRefresh) {
    // Unknown prefix — return 200 per RFC 7009
    return sendJson(res, 200, {});
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const db = getFirestore();

  try {
    const tokenDoc = await db.doc(`oauthTokens/${tokenHash}`).get();
    if (!tokenDoc.exists) {
      // Token not found — return 200 per RFC 7009
      return sendJson(res, 200, {});
    }

    const tokenData = tokenDoc.data()!;
    const now = Timestamp.fromDate(new Date());

    // Revoke this token
    await db.doc(`oauthTokens/${tokenHash}`).update({
      active: false,
      revokedAt: now,
    });

    // SARK F-4: If refresh token, revoke entire family
    if (isRefresh && tokenData.familyId) {
      const snapshot = await db.collection("oauthTokens")
        .where("familyId", "==", tokenData.familyId)
        .where("active", "==", true)
        .get();

      if (snapshot.size > 0) {
        const batch = db.batch();
        for (const doc of snapshot.docs) {
          batch.update(doc.ref, { active: false, revokedAt: now });
        }
        await batch.commit();
      }
    }
  } catch (error) {
    console.error("[OAuth] Revocation error:", error);
    // RFC 7009: always 200
  }

  return sendJson(res, 200, {});
}
