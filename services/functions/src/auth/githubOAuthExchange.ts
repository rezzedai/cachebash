/**
 * GitHub OAuth Token Exchange
 *
 * Exchanges a GitHub OAuth authorization code for an access token.
 * Required because the client secret cannot be stored in mobile code.
 *
 * POST body: { code: string, redirectUri: string }
 * Returns: { access_token: string }
 *
 * Setup:
 *   Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Google Cloud Secret Manager
 */

import * as functions from "firebase-functions/v1";
import { defineSecret } from "firebase-functions/params";

const githubClientId = defineSecret("GITHUB_CLIENT_ID");
const githubClientSecret = defineSecret("GITHUB_CLIENT_SECRET");

export const exchangeGithubCode = functions.runWith({ secrets: [githubClientId, githubClientSecret] }).https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
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

    const clientId = githubClientId.value();
    const clientSecret = githubClientSecret.value();

    if (!clientId || !clientSecret) {
      console.error("[githubOAuth] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET secrets");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("[githubOAuth] Token exchange failed:", data.error_description || data.error);
      res.status(400).json({ error: data.error_description || data.error });
      return;
    }

    if (!data.access_token) {
      console.error("[githubOAuth] No access_token in response");
      res.status(500).json({ error: "Token exchange failed" });
      return;
    }

    res.status(200).json({ access_token: data.access_token });
  } catch (err: any) {
    console.error("[githubOAuth] Exchange failed:", err);
    res.status(500).json({ error: "Token exchange failed" });
  }
});
