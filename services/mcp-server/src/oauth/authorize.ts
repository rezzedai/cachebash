/**
 * OAuth Authorization Endpoint — GET /authorize
 * Validates params, stores pending auth state, redirects to consent.
 * SARK F-1 CRITICAL: state parameter required for CSRF protection.
 * Track 2 Gate 1 H-4: per-clientId (30/min) + per-IP rate limits.
 */

import type http from "http";
import * as crypto from "crypto";
import { getFirestore } from "../firebase/client.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

// --- OAuth /authorize rate limiting ---

const OAUTH_CLIENT_LIMIT = 30; // per clientId per minute
const OAUTH_IP_LIMIT = 30;     // per IP per minute
const OAUTH_WINDOW_MS = 60_000;

const oauthWindows = new Map<string, number[]>();

function oauthSlidingWindowCheck(key: string, limit: number, now: number): boolean {
  const cutoff = now - OAUTH_WINDOW_MS;
  let timestamps = oauthWindows.get(key);
  if (!timestamps) {
    timestamps = [];
    oauthWindows.set(key, timestamps);
  }
  // Prune expired
  const pruned = timestamps.filter((t) => t > cutoff);
  if (pruned.length !== timestamps.length) {
    oauthWindows.set(key, pruned);
    timestamps = pruned;
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

/** Cleanup stale OAuth rate limit windows (called from main cleanup cycle) */
export function cleanupOAuthRateLimits(): void {
  const cutoff = Date.now() - OAUTH_WINDOW_MS * 2;
  for (const [key, timestamps] of oauthWindows.entries()) {
    const pruned = timestamps.filter((t) => t > cutoff);
    if (pruned.length === 0) {
      oauthWindows.delete(key);
    } else {
      oauthWindows.set(key, pruned);
    }
  }
}

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendErrorPage(res: http.ServerResponse, error: string, description: string): void {
  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><title>Authorization Error</title></head><body>
<h1>Authorization Error</h1><p><strong>${error}</strong>: ${description}</p>
</body></html>`);
}

function redirectWithError(res: http.ServerResponse, redirectUri: string, error: string, description: string, state?: string): void {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

export async function handleOAuthAuthorize(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  const responseType = reqUrl.searchParams.get("response_type");
  const clientId = reqUrl.searchParams.get("client_id");
  const redirectUri = reqUrl.searchParams.get("redirect_uri");
  const codeChallenge = reqUrl.searchParams.get("code_challenge");
  const codeChallengeMethod = reqUrl.searchParams.get("code_challenge_method");
  const state = reqUrl.searchParams.get("state");
  const scope = reqUrl.searchParams.get("scope") || "mcp:full";

  // Rate limit per IP before any Firestore reads
  const rateLimitNow = Date.now();
  if (!oauthSlidingWindowCheck(`oauth:ip:${clientIp}`, OAUTH_IP_LIMIT, rateLimitNow)) {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "too_many_requests", error_description: "Rate limit exceeded. Try again later." }));
    return;
  }

  // Validate client_id first — need it to check redirect_uri
  if (!clientId) {
    return sendErrorPage(res, "invalid_request", "client_id is required");
  }

  // Rate limit per clientId
  if (!oauthSlidingWindowCheck(`oauth:client:${clientId}`, OAUTH_CLIENT_LIMIT, rateLimitNow)) {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "too_many_requests", error_description: "Rate limit exceeded for this client. Try again later." }));
    return;
  }

  const db = getFirestore();
  const clientDoc = await db.doc(`oauthClients/${clientId}`).get();
  if (!clientDoc.exists) {
    return sendErrorPage(res, "invalid_request", "Unknown client_id");
  }
  const client = clientDoc.data()!;

  // Validate redirect_uri
  if (!redirectUri) {
    return sendErrorPage(res, "invalid_request", "redirect_uri is required");
  }
  if (!client.redirectUris.includes(redirectUri)) {
    // Don't redirect to unregistered URI — show error page instead
    return sendErrorPage(res, "invalid_request", "redirect_uri does not match any registered URI for this client");
  }

  // From here, we can safely redirect errors to the redirect_uri
  if (responseType !== "code") {
    return redirectWithError(res, redirectUri, "unsupported_response_type", "Only response_type=code is supported", state || undefined);
  }

  // SARK F-1 CRITICAL: state parameter required
  if (!state) {
    return redirectWithError(res, redirectUri, "invalid_request", "state parameter is required for CSRF protection");
  }

  // PKCE required
  if (!codeChallenge) {
    return redirectWithError(res, redirectUri, "invalid_request", "code_challenge is required (PKCE)", state);
  }
  if (codeChallengeMethod !== "S256") {
    return redirectWithError(res, redirectUri, "invalid_request", "code_challenge_method must be S256", state);
  }

  // Store pending auth state
  const pendingAuthId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  await db.collection("oauthPendingAuth").doc(pendingAuthId).set({
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    scope,
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  // Update client lastUsedAt for TTL (fire-and-forget)
  db.doc(`oauthClients/${clientId}`).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});

  // Redirect to consent screen
  res.writeHead(302, { Location: `/oauth/consent?pending=${pendingAuthId}` });
  res.end();
}
