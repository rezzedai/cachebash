/**
 * OAuth Consent Screen — GET/POST /oauth/consent
 * SARK F-3 MANDATE: No silent authorization. User must explicitly approve.
 *
 * GET: Renders plain HTML consent form
 * POST: Processes allow/deny, redirects to Firebase Auth or back to client
 */

import type http from "http";
import { getFirestore } from "../firebase/client.js";
import { getScopeDisplayInfo, SCOPE_DEFINITIONS } from "./scopes.js";

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

  const scope = pending.scope || "mcp:full";
  const scopes = scope.split(" ").filter(Boolean);
  return sendHtml(res, 200, consentPage(clientName, pendingAuthId, scopes));
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

/** Shared CSS for all OAuth pages — CacheBash branded dark theme */
const BRAND_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0A0A0B;
    color: #E4E4E7;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .card {
    background: #18181B;
    border: 1px solid #27272A;
    border-radius: 16px;
    max-width: 440px;
    width: 100%;
    padding: 40px 32px;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
  }
  .logo-icon {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #6366F1, #8B5CF6);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: white;
  }
  .logo-text {
    font-size: 18px;
    font-weight: 700;
    color: #FAFAFA;
    letter-spacing: -0.02em;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    color: #FAFAFA;
    margin-bottom: 8px;
  }
  .subtitle {
    font-size: 14px;
    color: #A1A1AA;
    line-height: 1.5;
    margin-bottom: 24px;
  }
  .client-name {
    color: #C4B5FD;
    font-weight: 600;
  }
  .scope-list {
    list-style: none;
    margin-bottom: 28px;
  }
  .scope-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #1F1F23;
    margin-bottom: 6px;
  }
  .scope-check {
    color: #6366F1;
    font-size: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .scope-info .scope-label {
    font-size: 14px;
    font-weight: 500;
    color: #E4E4E7;
  }
  .scope-info .scope-desc {
    font-size: 12px;
    color: #71717A;
    margin-top: 2px;
  }
  .actions {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }
  button, .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    text-decoration: none;
  }
  button:active, .btn:active { transform: scale(0.98); }
  .allow {
    background: #6366F1;
    color: white;
    flex: 1;
  }
  .allow:hover { background: #4F46E5; }
  .deny {
    background: #27272A;
    color: #A1A1AA;
    flex: 1;
  }
  .deny:hover { background: #3F3F46; color: #E4E4E7; }
  .loading {
    display: none;
    text-align: center;
    padding: 20px 0;
    color: #A1A1AA;
  }
  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #3F3F46;
    border-top-color: #6366F1;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 8px;
    vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .divider {
    height: 1px;
    background: #27272A;
    margin: 16px 0;
  }
  .footer {
    font-size: 12px;
    color: #52525B;
    text-align: center;
    margin-top: 16px;
  }
  @media (max-width: 480px) {
    .card { padding: 32px 20px; border-radius: 12px; }
    h1 { font-size: 18px; }
  }
`;

function consentPage(clientName: string, pendingAuthId: string, scopes: string[] = ["mcp:full"]): string {
  const escapedName = clientName.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const scopeDisplay = getScopeDisplayInfo(scopes);
  const scopeHtml = scopeDisplay.map((s) =>
    `<li class="scope-item">
      <span class="scope-check">&#10003;</span>
      <div class="scope-info">
        <div class="scope-label">${s.label}</div>
        <div class="scope-desc">${s.description}</div>
      </div>
    </li>`
  ).join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${escapedName} — CacheBash</title>
  <style>${BRAND_CSS}</style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">&#9889;</div>
      <span class="logo-text">CacheBash</span>
    </div>
    <h1>Authorize Application</h1>
    <p class="subtitle"><span class="client-name">${escapedName}</span> is requesting access to your CacheBash account.</p>
    <ul class="scope-list">
    ${scopeHtml}
    </ul>
    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="pending" value="${pendingAuthId}">
      <div class="actions">
        <button type="submit" name="action" value="deny" class="deny">Deny</button>
        <button type="submit" name="action" value="allow" class="allow">Allow</button>
      </div>
    </form>
    <div class="footer">You can revoke access at any time from your account settings.</div>
  </div>
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
  <style>${BRAND_CSS}
    .auth-buttons { display: flex; flex-direction: column; gap: 10px; }
    .btn-google {
      background: #FAFAFA;
      color: #18181B;
      gap: 10px;
    }
    .btn-google:hover { background: #E4E4E7; }
    .btn-github {
      background: #27272A;
      color: #E4E4E7;
      gap: 10px;
    }
    .btn-github:hover { background: #3F3F46; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">&#9889;</div>
      <span class="logo-text">CacheBash</span>
    </div>
    <h1>Sign in to continue</h1>
    <p class="subtitle">Authenticate with your account to complete authorization.</p>
    <div id="auth-buttons" class="auth-buttons">
      <a class="btn btn-google" id="google-btn" href="#">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M19.6 10.23c0-.71-.06-1.39-.18-2.05H10v3.87h5.38a4.6 4.6 0 01-2 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.35z" fill="#4285F4"/><path d="M10 20c2.7 0 4.96-.9 6.62-2.42l-3.23-2.51c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H1.06v2.59A10 10 0 0010 20z" fill="#34A853"/><path d="M4.4 11.9c-.2-.6-.31-1.24-.31-1.9s.11-1.3.31-1.9V5.51H1.06A10 10 0 000 10c0 1.61.39 3.14 1.06 4.49l3.34-2.59z" fill="#FBBC05"/><path d="M10 3.98c1.47 0 2.79.5 3.82 1.5l2.87-2.87C14.96.99 12.7 0 10 0 6.09 0 2.71 2.24 1.06 5.51l3.34 2.59C5.19 5.74 7.4 3.98 10 3.98z" fill="#EA4335"/></svg>
        Sign in with Google
      </a>
      <a class="btn btn-github" id="github-btn" href="#">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        Sign in with GitHub
      </a>
    </div>
    <div class="loading" id="loading">
      <span class="spinner"></span> Authenticating...
    </div>
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error — CacheBash</title>
  <style>${BRAND_CSS}</style>
</head>
<body>
  <div class="card" style="text-align: center;">
    <div class="logo" style="justify-content: center;">
      <div class="logo-icon">&#9889;</div>
      <span class="logo-text">CacheBash</span>
    </div>
    <h1>Authorization Error</h1>
    <p class="subtitle">${escaped}</p>
  </div>
</body>
</html>`;
}
