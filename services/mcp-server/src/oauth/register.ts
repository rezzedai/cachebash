/**
 * Dynamic Client Registration (DCR) — POST /register
 * RFC 7591 subset for public MCP clients.
 *
 * Rate limited: 10 registrations per hour per IP.
 * Clients auto-delete after 30 days unused (Firestore TTL on lastUsedAt).
 */

import type http from "http";
import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";

// In-memory sliding window rate limit for DCR (10/hr/IP)
const DCR_LIMIT = 10;
const DCR_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const dcrRateLimits = new Map<string, number[]>();

function checkDcrRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = dcrRateLimits.get(ip) || [];
  const filtered = timestamps.filter(ts => now - ts < DCR_WINDOW_MS);

  if (filtered.length >= DCR_LIMIT) {
    dcrRateLimits.set(ip, filtered);
    return false;
  }

  filtered.push(now);
  dcrRateLimits.set(ip, filtered);
  return true;
}

function validateRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    // Allow localhost (any port) or HTTPS
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;
    if (parsed.protocol === "https:") return true;
    return false;
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

export async function handleOAuthRegister(req: http.IncomingMessage, res: http.ServerResponse, authenticatedUserId?: string): Promise<void> {
  const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

  if (!checkDcrRateLimit(clientIp)) {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "3600" });
    res.end(JSON.stringify({ error: "too_many_requests", error_description: "DCR rate limit exceeded. Try again in 1 hour." }));
    return;
  }

  let body: any;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "invalid_request", error_description: "Invalid JSON body" });
  }

  // Validate client_name
  if (!body.client_name || typeof body.client_name !== "string") {
    return sendJson(res, 400, { error: "invalid_client_metadata", error_description: "client_name is required" });
  }
  if (body.client_name.length > 256) {
    return sendJson(res, 400, { error: "invalid_client_metadata", error_description: "client_name must be 256 characters or fewer" });
  }

  // Validate redirect_uris (if provided)
  if (body.redirect_uris && Array.isArray(body.redirect_uris)) {
    for (const uri of body.redirect_uris) {
      if (typeof uri !== "string" || !validateRedirectUri(uri)) {
        return sendJson(res, 400, { error: "invalid_redirect_uri", error_description: `Invalid redirect_uri: ${uri}. Must be localhost or HTTPS.` });
      }
    }
  }

  // Validate grant_types
  const grantTypes: string[] = body.grant_types || ["authorization_code"];
  if (!Array.isArray(grantTypes)) {
    return sendJson(res, 400, { error: "invalid_client_metadata", error_description: "grant_types must be an array" });
  }

  const isServiceAccount = grantTypes.includes("client_credentials");
  const isPublicClient = grantTypes.includes("authorization_code");

  if (!isServiceAccount && !isPublicClient) {
    return sendJson(res, 400, { error: "invalid_client_metadata", error_description: "grant_types must include authorization_code or client_credentials" });
  }

  // Service accounts require authenticated user (tenant scoping)
  if (isServiceAccount && !authenticatedUserId) {
    return sendJson(res, 401, { error: "unauthorized", error_description: "Bearer token required to register service accounts" });
  }

  // Service accounts (client_credentials) don't need redirect_uris
  if (isPublicClient && (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0)) {
    return sendJson(res, 400, { error: "invalid_redirect_uri", error_description: "redirect_uris required for authorization_code grant" });
  }

  const clientId = crypto.randomUUID();
  const responseTypes = isPublicClient ? (body.response_types || ["code"]) : [];
  const tokenEndpointAuthMethod = isServiceAccount ? "client_secret_post" : (body.token_endpoint_auth_method || "none");

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();

  const clientDoc: Record<string, unknown> = {
    clientId,
    clientName: body.client_name,
    redirectUris: isPublicClient ? body.redirect_uris : [],
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
    createdAt: now,
    lastUsedAt: now,
  };

  // For service accounts, generate and store a client secret
  let clientSecret: string | undefined;
  if (isServiceAccount) {
    clientSecret = "cbs_" + crypto.randomBytes(32).toString("hex");
    const secretHash = crypto.createHash("sha256").update(clientSecret).digest("hex");
    clientDoc.clientSecretHash = secretHash;
    clientDoc.isServiceAccount = true;
    clientDoc.userId = authenticatedUserId;
  }

  await db.collection("oauthClients").doc(clientId).set(clientDoc);

  const response: Record<string, unknown> = {
    client_id: clientId,
    client_name: body.client_name,
    redirect_uris: isPublicClient ? body.redirect_uris : [],
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  };

  // Return secret only once
  if (clientSecret) {
    response.client_secret = clientSecret;
  }

  sendJson(res, 201, response);
}

/** Cleanup stale DCR rate limit entries (call periodically) */
export function cleanupDcrRateLimits(): void {
  const now = Date.now();
  for (const [ip, timestamps] of dcrRateLimits.entries()) {
    const filtered = timestamps.filter(ts => now - ts < DCR_WINDOW_MS);
    if (filtered.length === 0) {
      dcrRateLimits.delete(ip);
    } else {
      dcrRateLimits.set(ip, filtered);
    }
  }
}
