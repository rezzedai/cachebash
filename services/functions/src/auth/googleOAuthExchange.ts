/**
 * Google OAuth Token Exchange
 *
 * Exchanges a Google OAuth authorization code for an access token.
 * Required because the client secret cannot be stored in mobile code.
 *
 * POST body: { code: string, redirectUri: string }
 * Returns: { access_token: string, id_token: string }
 *
 * Setup:
 *   firebase functions:secrets:set GOOGLE_CLIENT_ID
 *   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
 */

import * as functions from "firebase-functions/v1";
import { defineSecret } from "firebase-functions/params";

const googleClientId = defineSecret("GOOGLE_CLIENT_ID");
const googleClientSecret = defineSecret("GOOGLE_CLIENT_SECRET");

const CORS_ALLOWLIST = [
  "https://app.cachebash.dev",
  "https://grid-portal.web.app",
  "http://localhost:3000",
];

export const exchangeGoogleCode = functions.runWith({ secrets: [googleClientId, googleClientSecret] }).https.onRequest(async (req, res) => {
  // CORS — restrict to known origins
  const origin = req.headers.origin || "";
  if (CORS_ALLOWLIST.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { code, redirectUri } = req.body;

    if (!code) {
      res.status(400).json({ error: "Missing code parameter" });
      return;
    }

    const clientId = googleClientId.value();
    const clientSecret = googleClientSecret.value();

    if (!clientId || !clientSecret) {
      console.error("[googleOAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET secrets");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("[googleOAuth] Token exchange failed:", data.error_description || data.error);
      res.status(400).json({ error: data.error_description || data.error });
      return;
    }

    if (!data.access_token) {
      console.error("[googleOAuth] No access_token in response");
      res.status(500).json({ error: "Token exchange failed" });
      return;
    }

    res.status(200).json({
      access_token: data.access_token,
      id_token: data.id_token || null,
    });
  } catch (err: any) {
    console.error("[googleOAuth] Exchange failed:", err);
    res.status(500).json({ error: "Token exchange failed" });
  }
});
