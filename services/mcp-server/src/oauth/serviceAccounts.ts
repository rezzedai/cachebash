/**
 * Service Account Management — OAuth Layer 2 Wave 3
 *
 * GET  /oauth/service-accounts — list service accounts for authenticated user
 * DELETE /oauth/service-accounts/{clientId} — revoke service account + cascade tokens
 *
 * Requires mcp:admin scope or API key auth.
 */

import type http from "http";
import { getFirestore } from "../firebase/client.js";
import { Timestamp } from "firebase-admin/firestore";
import type { AuthContext } from "../auth/authValidator.js";
import { hasScope } from "./scopes.js";

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Check if auth context has permission to manage service accounts.
 * Requires mcp:admin scope (OAuth) or any API key auth.
 */
function canManageServiceAccounts(auth: AuthContext): boolean {
  // API key auth always allowed (admin context)
  if (!auth.oauthScopes) return true;
  // OAuth tokens need mcp:admin
  return hasScope(auth.oauthScopes, "mcp:admin");
}

export async function handleServiceAccounts(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: AuthContext
): Promise<void> {
  if (!canManageServiceAccounts(auth)) {
    return sendJson(res, 403, {
      error: "insufficient_scope",
      error_description: "mcp:admin scope required to manage service accounts",
    });
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // /oauth/service-accounts or /oauth/service-accounts/{clientId}
  const clientId = pathParts.length >= 3 ? pathParts[2] : null;

  if (req.method === "GET" && !clientId) {
    return listServiceAccounts(auth, res);
  }
  if (req.method === "DELETE" && clientId) {
    return revokeServiceAccount(auth, clientId, res);
  }

  sendJson(res, 405, { error: "method_not_allowed" });
}

async function listServiceAccounts(auth: AuthContext, res: http.ServerResponse): Promise<void> {
  const db = getFirestore();

  try {
    const snapshot = await db
      .collection("oauthClients")
      .where("isServiceAccount", "==", true)
      .where("userId", "==", auth.userId)
      .get();

    const accounts = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        client_id: data.clientId,
        client_name: data.clientName,
        grant_types: data.grantTypes,
        created_at: data.createdAt?.toDate?.()?.toISOString() || null,
        last_used_at: data.lastUsedAt?.toDate?.()?.toISOString() || null,
        revoked: data.revokedAt != null,
      };
    });

    return sendJson(res, 200, { service_accounts: accounts, count: accounts.length });
  } catch (error) {
    console.error("[OAuth] List service accounts failed:", error);
    return sendJson(res, 500, { error: "server_error" });
  }
}

async function revokeServiceAccount(auth: AuthContext, clientId: string, res: http.ServerResponse): Promise<void> {
  const db = getFirestore();

  try {
    const clientDoc = await db.doc(`oauthClients/${clientId}`).get();
    if (!clientDoc.exists) {
      return sendJson(res, 404, { error: "not_found", error_description: "Service account not found" });
    }

    const clientData = clientDoc.data()!;

    // Verify ownership
    if (clientData.userId !== auth.userId) {
      return sendJson(res, 403, { error: "forbidden", error_description: "Service account belongs to a different tenant" });
    }

    if (!clientData.isServiceAccount) {
      return sendJson(res, 400, { error: "invalid_request", error_description: "Client is not a service account" });
    }

    const now = Timestamp.fromDate(new Date());

    // Cascade: revoke all active tokens for this client
    const tokensSnapshot = await db
      .collection("oauthTokens")
      .where("clientId", "==", clientId)
      .where("active", "==", true)
      .get();

    const batch = db.batch();

    // Revoke the client itself
    batch.update(db.doc(`oauthClients/${clientId}`), { revokedAt: now, active: false });

    // Revoke all tokens
    for (const tokenDoc of tokensSnapshot.docs) {
      batch.update(tokenDoc.ref, { active: false, revokedAt: now });
    }

    await batch.commit();

    return sendJson(res, 200, {
      revoked: true,
      client_id: clientId,
      tokens_revoked: tokensSnapshot.size,
    });
  } catch (error) {
    console.error("[OAuth] Revoke service account failed:", error);
    return sendJson(res, 500, { error: "server_error" });
  }
}
