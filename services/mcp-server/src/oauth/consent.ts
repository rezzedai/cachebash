/**
 * OAuth Consent Screen — GET/POST /oauth/consent
 * SARK F-3 MANDATE: No silent authorization. User must explicitly approve.
 *
 * GET: Renders plain HTML consent form
 * POST: Processes allow/deny, redirects to Firebase Auth or back to client
 */

import type http from "http";
import { getFirestore } from "../firebase/client.js";

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
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

function parseFormData(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

function getIssuer(req: http.IncomingMessage): string {
  if (process.env.OAUTH_ISSUER) return process.env.OAUTH_ISSUER;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  return `${proto}://${host}`;
}

export async function handleOAuthConsent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === "GET") {
    return handleConsentGet(req, res);
  }
  if (req.method === "POST") {
    return handleConsentPost(req, res);
  }
  sendJson(res, 405, { error: "method_not_allowed" });
}

async function handleConsentGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pendingAuthId = reqUrl.searchParams.get("pending");

  if (!pendingAuthId) {
    return sendHtml(res, 400, errorPage("Missing pending authorization ID"));
  }

  const db = getFirestore();
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

  // Look up client name
  const clientDoc = await db.doc(`oauthClients/${pending.clientId}`).get();
  const clientName = clientDoc.exists ? clientDoc.data()!.clientName : pending.clientId;

  return sendHtml(res, 200, consentPage(clientName, pendingAuthId));
}

async function handleConsentPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const form = parseFormData(body);

  const pendingAuthId = form.pending;
  const action = form.action;

  if (!pendingAuthId) {
    return sendHtml(res, 400, errorPage("Missing pending authorization ID"));
  }

  const db = getFirestore();
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

  if (action === "deny") {
    // Clean up pending auth
    await db.doc(`oauthPendingAuth/${pendingAuthId}`).delete();
    // Redirect with access_denied error
    const url = new URL(pending.redirectUri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "User denied the authorization request");
    url.searchParams.set("state", pending.state);
    res.writeHead(302, { Location: url.toString() });
    res.end();
    return;
  }

  // action === "allow" — redirect to Firebase Auth sign-in
  // After Firebase Auth, user is redirected to /authorize/callback
  const issuer = getIssuer(req);
  const callbackUrl = `${issuer}/authorize/callback?pending=${pendingAuthId}`;

  // Render a page that initiates Firebase Auth
  // Using Firebase Auth REST API — redirect to Google sign-in via Firebase
  return sendHtml(res, 200, firebaseAuthPage(callbackUrl, pendingAuthId));
}

function consentPage(clientName: string, pendingAuthId: string): string {
  const escapedName = clientName.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${escapedName} — CacheBash</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 40px auto; padding: 20px; color: #333; }
    h1 { font-size: 1.4em; }
    .scope { background: #f5f5f5; padding: 12px; border-radius: 6px; margin: 16px 0; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    button { padding: 10px 24px; border: none; border-radius: 6px; font-size: 1em; cursor: pointer; }
    .allow { background: #2563eb; color: white; }
    .allow:hover { background: #1d4ed8; }
    .deny { background: #e5e7eb; color: #374151; }
    .deny:hover { background: #d1d5db; }
  </style>
</head>
<body>
  <h1>Authorize ${escapedName}</h1>
  <p><strong>${escapedName}</strong> is requesting access to your CacheBash account.</p>
  <div class="scope">
    <strong>Permissions:</strong> Full MCP access (read and write all tools)
  </div>
  <form method="POST" action="/oauth/consent">
    <input type="hidden" name="pending" value="${pendingAuthId}">
    <div class="actions">
      <button type="submit" name="action" value="allow" class="allow">Allow</button>
      <button type="submit" name="action" value="deny" class="deny">Deny</button>
    </div>
  </form>
</body>
</html>`;
}

function firebaseAuthPage(callbackUrl: string, pendingAuthId: string): string {
  const escapedCallback = callbackUrl.replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign In — CacheBash</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 40px auto; padding: 20px; text-align: center; color: #333; }
    .btn { display: inline-block; padding: 12px 32px; margin: 8px; border-radius: 6px; text-decoration: none; font-size: 1em; cursor: pointer; border: 1px solid #ddd; background: white; }
    .btn:hover { background: #f5f5f5; }
    .loading { display: none; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>Sign in to continue</h1>
  <p>Authenticate with your CacheBash account to complete authorization.</p>
  <div id="auth-buttons">
    <a class="btn" id="google-btn" href="#">Sign in with Google</a>
    <br>
    <a class="btn" id="github-btn" href="#">Sign in with GitHub</a>
  </div>
  <div class="loading" id="loading">
    <p>Authenticating...</p>
  </div>
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
    import { getAuth, signInWithPopup, GoogleAuthProvider, GithubAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCIVp0MFpi5B4pCkFXKUCbD33y7NpFZ7Rs",
      authDomain: "cachebash-app.firebaseapp.com",
      projectId: "cachebash-app",
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    async function signIn(provider) {
      try {
        document.getElementById("auth-buttons").style.display = "none";
        document.getElementById("loading").style.display = "block";
        const result = await signInWithPopup(auth, provider);
        const idToken = await result.user.getIdToken();
        // Redirect to callback with the ID token
        window.location.href = "${escapedCallback}&id_token=" + encodeURIComponent(idToken);
      } catch (error) {
        document.getElementById("auth-buttons").style.display = "block";
        document.getElementById("loading").style.display = "none";
        alert("Authentication failed: " + error.message);
      }
    }

    document.getElementById("google-btn").addEventListener("click", (e) => {
      e.preventDefault();
      signIn(new GoogleAuthProvider());
    });

    document.getElementById("github-btn").addEventListener("click", (e) => {
      e.preventDefault();
      signIn(new GithubAuthProvider());
    });
  </script>
</body>
</html>`;
}

function errorPage(message: string): string {
  const escaped = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><head><title>Error — CacheBash</title></head><body>
<h1>Authorization Error</h1><p>${escaped}</p>
</body></html>`;
}
