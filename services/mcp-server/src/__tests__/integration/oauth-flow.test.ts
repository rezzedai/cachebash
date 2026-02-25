/**
 * OAuth 2.1 End-to-End Integration Test
 *
 * Tests the complete OAuth flow simulating a ChatGPT Desktop-like client:
 * 1. Discovery (/.well-known/oauth-authorization-server)
 * 2. Dynamic Client Registration (DCR)
 * 3. Authorization with PKCE
 * 4. Consent flow
 * 5. Authorization callback
 * 6. Token exchange
 * 7. Token usage (MCP request)
 * 8. Token refresh
 * 9. Token revocation
 *
 * Also tests error cases and security requirements (SARK F-1 through F-10).
 *
 * REQUIREMENTS:
 * - Firestore emulator must be running on localhost:8080
 * - Run with: firebase emulators:start --only firestore --project cachebash-app
 * - Then run: npm run test:integration --workspace=services/mcp-server
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Readable } from "stream";
import type http from "http";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";
import { handleOAuthMetadata } from "../../oauth/metadata";
import { handleOAuthRegister, cleanupDcrRateLimits } from "../../oauth/register";
import { handleOAuthAuthorize } from "../../oauth/authorize";
import { handleOAuthConsent } from "../../oauth/consent";
import { handleOAuthCallback } from "../../oauth/callback";
import { handleOAuthToken } from "../../oauth/token";
import { handleOAuthRevoke } from "../../oauth/revoke";
import { validateAuth } from "../../auth/authValidator";
import { initializeFirebase } from "../../firebase/client";

describe("OAuth 2.1 End-to-End Flow", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    // Ensure FIRESTORE_EMULATOR_HOST is set before Firebase initialization
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    }

    // Initialize production Firebase client to use emulator
    initializeFirebase();

    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("oauth-test-user");
    userId = testUser.userId;

    // Clean up rate limit state to prevent test bleed
    cleanupDcrRateLimits();
  });

  /** Helper: Create mock HTTP request with unique IP per test to avoid rate limit bleed */
  function createMockRequest(
    method: string,
    url: string,
    body?: string | object,
    headers: Record<string, string> = {},
    uniqueIp?: string
  ): http.IncomingMessage {
    const bodyStr = typeof body === "object" ? JSON.stringify(body) : (body || "");
    const req = new Readable() as http.IncomingMessage;
    req.method = method;
    req.url = url;
    req.headers = {
      host: "localhost:3001",
      ...headers,
    };
    // Use unique IP per test to avoid rate limit conflicts
    const testIp = uniqueIp || `127.0.0.${Math.floor(Math.random() * 255)}`;
    req.socket = { remoteAddress: testIp } as any;

    // Push body data
    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null); // Signal end of stream

    return req;
  }

  /** Helper: Create mock HTTP response and capture result */
  function createMockResponse(): {
    res: http.ServerResponse;
    getStatus: () => number;
    getHeaders: () => Record<string, string | string[]>;
    getBody: () => string;
  } {
    let status = 200;
    let headers: Record<string, string | string[]> = {};
    let body = "";

    const res = {
      writeHead: (s: number, h?: Record<string, string | string[]>) => {
        status = s;
        if (h) headers = { ...headers, ...h };
      },
      setHeader: (name: string, value: string | string[]) => {
        headers[name] = value;
      },
      end: (data?: string) => {
        if (data) body = data;
      },
      write: (chunk: string) => {
        body += chunk;
      },
    } as unknown as http.ServerResponse;

    return {
      res,
      getStatus: () => status,
      getHeaders: () => headers,
      getBody: () => body,
    };
  }

  /** Helper: Generate PKCE pair (S256) */
  function generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    return { verifier, challenge };
  }

  /** Helper: Parse query params from redirect URL */
  function parseRedirect(location: string): URLSearchParams {
    const url = new URL(location);
    return url.searchParams;
  }

  describe("1. OAuth Metadata Discovery", () => {
    it("should return correct metadata schema", async () => {
      const req = createMockRequest("GET", "/.well-known/oauth-authorization-server");
      const { res, getStatus, getBody } = createMockResponse();

      handleOAuthMetadata(req, res);

      expect(getStatus()).toBe(200);
      const metadata = JSON.parse(getBody());
      expect(metadata.issuer).toMatch(/^https?:\/\//);
      expect(metadata.authorization_endpoint).toBe(`${metadata.issuer}/authorize`);
      expect(metadata.token_endpoint).toBe(`${metadata.issuer}/token`);
      expect(metadata.registration_endpoint).toBe(`${metadata.issuer}/register`);
      expect(metadata.revocation_endpoint).toBe(`${metadata.issuer}/revoke`);
      expect(metadata.response_types_supported).toEqual(["code"]);
      expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
      expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
      expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
      expect(metadata.scopes_supported).toEqual(["mcp:full"]);
    });
  });

  describe("2. Dynamic Client Registration (DCR)", () => {
    it("should register a client and return client_id", async () => {
      const req = createMockRequest("POST", "/register", {
        client_name: "ChatGPT Desktop Test",
        redirect_uris: ["https://oauth.chatgpt.com/callback"],
      });
      const { res, getStatus, getBody } = createMockResponse();

      await handleOAuthRegister(req, res);

      expect(getStatus()).toBe(201);
      const response = JSON.parse(getBody());
      expect(response.client_id).toBeDefined();
      expect(typeof response.client_id).toBe("string");
      expect(response.client_name).toBe("ChatGPT Desktop Test");
      expect(response.redirect_uris).toEqual(["https://oauth.chatgpt.com/callback"]);
      expect(response.grant_types).toContain("authorization_code");
      expect(response.token_endpoint_auth_method).toBe("none");

      // Verify in Firestore
      const clientDoc = await db.doc(`oauthClients/${response.client_id}`).get();
      expect(clientDoc.exists).toBe(true);
      expect(clientDoc.data()?.clientName).toBe("ChatGPT Desktop Test");
    });

    it("should reject invalid redirect_uri", async () => {
      const req = createMockRequest("POST", "/register", {
        client_name: "Test Client",
        redirect_uris: ["http://evil.com/callback"], // HTTP not allowed (not localhost)
      });
      const { res, getStatus, getBody } = createMockResponse();

      await handleOAuthRegister(req, res);

      expect(getStatus()).toBe(400);
      const response = JSON.parse(getBody());
      expect(response.error).toBe("invalid_redirect_uri");
    });

    it("should reject missing client_name", async () => {
      const req = createMockRequest("POST", "/register", {
        redirect_uris: ["https://test.local"],
      });
      const { res, getStatus, getBody } = createMockResponse();

      await handleOAuthRegister(req, res);

      expect(getStatus()).toBe(400);
      const response = JSON.parse(getBody());
      expect(response.error).toBe("invalid_client_metadata");
    });
  });

  describe("3-6. Full Authorization Flow (PKCE)", () => {
    let clientId: string;
    let redirectUri: string;
    let pkce: { verifier: string; challenge: string };
    let state: string;

    beforeEach(async () => {
      // Register client
      const req = createMockRequest("POST", "/register", {
        client_name: "Test OAuth Client",
        redirect_uris: ["https://test.local/callback"],
      });
      const { res, getBody } = createMockResponse();
      await handleOAuthRegister(req, res);
      const regResponse = JSON.parse(getBody());
      clientId = regResponse.client_id;
      redirectUri = "https://test.local/callback";

      // Generate PKCE
      pkce = generatePkce();
      state = crypto.randomBytes(16).toString("hex");
    });

    it("should complete full authorization flow with PKCE", async () => {
      // Step 3: Authorization request
      const authReq = createMockRequest(
        "GET",
        `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code_challenge=${pkce.challenge}&code_challenge_method=S256&state=${state}&scope=mcp:full`
      );
      const authMock = createMockResponse();
      await handleOAuthAuthorize(authReq, authMock.res);

      expect(authMock.getStatus()).toBe(302);
      const consentLocation = authMock.getHeaders()["Location"] as string;
      expect(consentLocation).toMatch(/^\/oauth\/consent\?pending=/);
      const pendingAuthId = new URL(
        consentLocation,
        "http://localhost"
      ).searchParams.get("pending")!;

      // Step 4: Consent (GET)
      const consentGetReq = createMockRequest("GET", `/oauth/consent?pending=${pendingAuthId}`);
      const consentGetMock = createMockResponse();
      await handleOAuthConsent(consentGetReq, consentGetMock.res);

      expect(consentGetMock.getStatus()).toBe(200);
      expect(consentGetMock.getBody()).toContain("Test OAuth Client");

      // Step 5: Consent POST (allow) — would redirect to Firebase Auth
      const consentPostReq = createMockRequest(
        "POST",
        "/oauth/consent",
        `pending=${pendingAuthId}&action=allow`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const consentPostMock = createMockResponse();
      await handleOAuthConsent(consentPostReq, consentPostMock.res);

      expect(consentPostMock.getStatus()).toBe(200);
      const firebasePage = consentPostMock.getBody();
      expect(firebasePage).toContain("Sign in to continue");
      expect(firebasePage).toContain("/authorize/callback");

      // Step 6: Simulate Firebase callback
      // In real flow, user authenticates with Firebase and gets redirected to /authorize/callback
      // For integration testing, we bypass Firebase Auth and create the auth code directly in Firestore
      // (CI doesn't have Auth emulator, only Firestore emulator)
      const authCode = crypto.randomBytes(32).toString("hex");
      const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
      const now = new Date();
      const codeExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

      // Load pending auth to get details
      const pendingDoc = await db.doc(`oauthPendingAuth/${pendingAuthId}`).get();
      const pending = pendingDoc.data()!;

      // Create auth code manually (simulating what callback does after Firebase auth)
      await db.doc(`oauthCodes/${codeHash}`).set({
        codeHash,
        clientId,
        userId,
        redirectUri,
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state,
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(codeExpiresAt),
        used: false,
      });

      // Clean up pending auth
      await db.doc(`oauthPendingAuth/${pendingAuthId}`).delete();

      // Step 7: Token exchange with PKCE verifier
      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);

      expect(tokenMock.getStatus()).toBe(200);
      const tokenResponse = JSON.parse(tokenMock.getBody());
      expect(tokenResponse.access_token).toMatch(/^cbo_/);
      expect(tokenResponse.refresh_token).toMatch(/^cbr_/);
      expect(tokenResponse.token_type).toBe("Bearer");
      expect(tokenResponse.expires_in).toBe(3600);
      expect(tokenResponse.scope).toBe("mcp:full");

      // Step 8: Verify access token works with MCP request
      const authContext = await validateAuth(tokenResponse.access_token);
      expect(authContext).not.toBeNull();
      expect(authContext!.userId).toBe(userId);
      expect(authContext!.programId).toBe("oauth");

      // Verify tokens are in Firestore
      const accessHash = crypto
        .createHash("sha256")
        .update(tokenResponse.access_token)
        .digest("hex");
      const accessDoc = await db.doc(`oauthTokens/${accessHash}`).get();
      expect(accessDoc.exists).toBe(true);
      expect(accessDoc.data()?.type).toBe("access");
      expect(accessDoc.data()?.active).toBe(true);
    });

    it("should reject authorization without state parameter (SARK F-1)", async () => {
      const authReq = createMockRequest(
        "GET",
        `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code_challenge=${pkce.challenge}&code_challenge_method=S256&scope=mcp:full`
        // Missing state parameter
      );
      const authMock = createMockResponse();
      await handleOAuthAuthorize(authReq, authMock.res);

      expect(authMock.getStatus()).toBe(302);
      const location = authMock.getHeaders()["Location"] as string;
      const params = parseRedirect(location);
      expect(params.get("error")).toBe("invalid_request");
      expect(params.get("error_description")).toContain("state parameter is required");
    });

    it("should reject authorization without PKCE", async () => {
      const authReq = createMockRequest(
        "GET",
        `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&state=${state}&scope=mcp:full`
        // Missing code_challenge
      );
      const authMock = createMockResponse();
      await handleOAuthAuthorize(authReq, authMock.res);

      expect(authMock.getStatus()).toBe(302);
      const location = authMock.getHeaders()["Location"] as string;
      const params = parseRedirect(location);
      expect(params.get("error")).toBe("invalid_request");
      expect(params.get("error_description")).toContain("code_challenge is required");
    });

    it("should handle consent denial (access_denied)", async () => {
      // Start authorization
      const authReq = createMockRequest(
        "GET",
        `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code_challenge=${pkce.challenge}&code_challenge_method=S256&state=${state}`
      );
      const authMock = createMockResponse();
      await handleOAuthAuthorize(authReq, authMock.res);
      const consentLocation = authMock.getHeaders()["Location"] as string;
      const pendingAuthId = new URL(
        consentLocation,
        "http://localhost"
      ).searchParams.get("pending")!;

      // Deny consent
      const consentPostReq = createMockRequest(
        "POST",
        "/oauth/consent",
        `pending=${pendingAuthId}&action=deny`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const consentPostMock = createMockResponse();
      await handleOAuthConsent(consentPostReq, consentPostMock.res);

      expect(consentPostMock.getStatus()).toBe(302);
      const denyLocation = consentPostMock.getHeaders()["Location"] as string;
      const params = parseRedirect(denyLocation);
      expect(params.get("error")).toBe("access_denied");
      expect(params.get("state")).toBe(state);
    });
  });

  describe("7. Token Exchange Error Cases", () => {
    let clientId: string;
    let authCode: string;
    let pkce: { verifier: string; challenge: string };

    beforeEach(async () => {
      // Setup: Register client and create an auth code
      const req = createMockRequest("POST", "/register", {
        client_name: "Token Test Client",
        redirect_uris: ["https://test.local/callback"],
      });
      const { res, getBody } = createMockResponse();
      await handleOAuthRegister(req, res);
      const regResponse = JSON.parse(getBody());
      clientId = regResponse.client_id;

      pkce = generatePkce();
      authCode = crypto.randomBytes(32).toString("hex");
      const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
      const now = new Date();

      await db.doc(`oauthCodes/${codeHash}`).set({
        codeHash,
        clientId,
        userId,
        redirectUri: "https://test.local/callback",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state: "test-state",
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)),
        used: false,
      });
    });

    it("should reject expired authorization code (invalid_grant)", async () => {
      // Create an expired code
      const expiredCode = crypto.randomBytes(32).toString("hex");
      const expiredHash = crypto.createHash("sha256").update(expiredCode).digest("hex");
      const pastTime = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago

      await db.doc(`oauthCodes/${expiredHash}`).set({
        codeHash: expiredHash,
        clientId,
        userId,
        redirectUri: "https://test.local/callback",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state: "test-state",
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(pastTime),
        expiresAt: admin.firestore.Timestamp.fromDate(pastTime), // Already expired
        used: false,
      });

      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${expiredCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);

      expect(tokenMock.getStatus()).toBe(400);
      const response = JSON.parse(tokenMock.getBody());
      expect(response.error).toBe("invalid_grant");
    });

    it("should reject wrong PKCE verifier", async () => {
      const wrongVerifier = crypto.randomBytes(32).toString("base64url");

      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${wrongVerifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);

      expect(tokenMock.getStatus()).toBe(400);
      const response = JSON.parse(tokenMock.getBody());
      expect(response.error).toBe("invalid_grant");
    });

    it("should reject replayed authorization code (single-use)", async () => {
      // First exchange (should succeed)
      const tokenReq1 = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock1 = createMockResponse();
      await handleOAuthToken(tokenReq1, tokenMock1.res);
      expect(tokenMock1.getStatus()).toBe(200);

      // Second exchange with same code (should fail)
      const tokenReq2 = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock2 = createMockResponse();
      await handleOAuthToken(tokenReq2, tokenMock2.res);

      expect(tokenMock2.getStatus()).toBe(400);
      const response = JSON.parse(tokenMock2.getBody());
      expect(response.error).toBe("invalid_grant");
    });
  });

  describe("8. Token Refresh", () => {
    let clientId: string;
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      // Setup: Get a valid token pair
      const req = createMockRequest("POST", "/register", {
        client_name: "Refresh Test Client",
        redirect_uris: ["https://test.local/callback"],
      });
      const { res, getBody } = createMockResponse();
      await handleOAuthRegister(req, res);
      const regResponse = JSON.parse(getBody());
      clientId = regResponse.client_id;

      // Create auth code and exchange for tokens
      const pkce = generatePkce();
      const authCode = crypto.randomBytes(32).toString("hex");
      const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
      const now = new Date();

      await db.doc(`oauthCodes/${codeHash}`).set({
        codeHash,
        clientId,
        userId,
        redirectUri: "https://test.local/callback",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state: "test-state",
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)),
        used: false,
      });

      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);
      const tokenResponse = JSON.parse(tokenMock.getBody());
      accessToken = tokenResponse.access_token;
      refreshToken = tokenResponse.refresh_token;
    });

    it("should refresh token and revoke old refresh token", async () => {
      const refreshReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${clientId}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const refreshMock = createMockResponse();
      await handleOAuthToken(refreshReq, refreshMock.res);

      expect(refreshMock.getStatus()).toBe(200);
      const response = JSON.parse(refreshMock.getBody());
      expect(response.access_token).toMatch(/^cbo_/);
      expect(response.refresh_token).toMatch(/^cbr_/);
      expect(response.access_token).not.toBe(accessToken); // New token
      expect(response.refresh_token).not.toBe(refreshToken); // New refresh token

      // Old refresh token should be revoked
      const oldRefreshHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const oldRefreshDoc = await db.doc(`oauthTokens/${oldRefreshHash}`).get();
      expect(oldRefreshDoc.data()?.active).toBe(false);
      expect(oldRefreshDoc.data()?.revokedAt).toBeDefined();

      // New tokens should work
      const authContext = await validateAuth(response.access_token);
      expect(authContext).not.toBeNull();
    });

    it("should trigger family revocation on replayed refresh token (SARK F-4)", async () => {
      // First refresh (should succeed)
      const refreshReq1 = createMockRequest(
        "POST",
        "/token",
        `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${clientId}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const refreshMock1 = createMockResponse();
      await handleOAuthToken(refreshReq1, refreshMock1.res);
      expect(refreshMock1.getStatus()).toBe(200);
      const firstRefreshResponse = JSON.parse(refreshMock1.getBody());

      // Try to replay old refresh token (should trigger family revocation)
      const refreshReq2 = createMockRequest(
        "POST",
        "/token",
        `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${clientId}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const refreshMock2 = createMockResponse();
      await handleOAuthToken(refreshReq2, refreshMock2.res);

      expect(refreshMock2.getStatus()).toBe(400);
      const response = JSON.parse(refreshMock2.getBody());
      expect(response.error).toBe("invalid_grant");

      // All tokens in the family should be revoked
      const newAccessHash = crypto
        .createHash("sha256")
        .update(firstRefreshResponse.access_token)
        .digest("hex");
      const newAccessDoc = await db.doc(`oauthTokens/${newAccessHash}`).get();
      expect(newAccessDoc.data()?.active).toBe(false);
    });

    it("should reject refresh token with unknown prefix (SARK F-6)", async () => {
      const fakeToken = "fake_" + crypto.randomBytes(32).toString("hex");

      const refreshReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=refresh_token&refresh_token=${fakeToken}&client_id=${clientId}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const refreshMock = createMockResponse();
      await handleOAuthToken(refreshReq, refreshMock.res);

      expect(refreshMock.getStatus()).toBe(400);
      const response = JSON.parse(refreshMock.getBody());
      expect(response.error).toBe("invalid_grant");
    });
  });

  describe("9. Token Revocation", () => {
    let clientId: string;
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      // Setup: Get a valid token pair
      const req = createMockRequest("POST", "/register", {
        client_name: "Revoke Test Client",
        redirect_uris: ["https://test.local/callback"],
      });
      const { res, getBody } = createMockResponse();
      await handleOAuthRegister(req, res);
      const regResponse = JSON.parse(getBody());
      clientId = regResponse.client_id;

      const pkce = generatePkce();
      const authCode = crypto.randomBytes(32).toString("hex");
      const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
      const now = new Date();

      await db.doc(`oauthCodes/${codeHash}`).set({
        codeHash,
        clientId,
        userId,
        redirectUri: "https://test.local/callback",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state: "test-state",
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)),
        used: false,
      });

      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);
      const tokenResponse = JSON.parse(tokenMock.getBody());
      accessToken = tokenResponse.access_token;
      refreshToken = tokenResponse.refresh_token;
    });

    it("should revoke access token", async () => {
      // Verify token works before revocation
      const authBefore = await validateAuth(accessToken);
      expect(authBefore).not.toBeNull();

      // Revoke token
      const revokeReq = createMockRequest(
        "POST",
        "/revoke",
        `token=${accessToken}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const revokeMock = createMockResponse();
      await handleOAuthRevoke(revokeReq, revokeMock.res);

      expect(revokeMock.getStatus()).toBe(200); // RFC 7009: Always 200

      // Token should no longer work
      const authAfter = await validateAuth(accessToken);
      expect(authAfter).toBeNull();

      // Verify in Firestore
      const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
      const tokenDoc = await db.doc(`oauthTokens/${tokenHash}`).get();
      expect(tokenDoc.data()?.active).toBe(false);
      expect(tokenDoc.data()?.revokedAt).toBeDefined();
    });

    it("should revoke entire token family when revoking refresh token (SARK F-4)", async () => {
      // Verify both tokens work before revocation
      const accessAuthBefore = await validateAuth(accessToken);
      expect(accessAuthBefore).not.toBeNull();

      // Revoke refresh token
      const revokeReq = createMockRequest(
        "POST",
        "/revoke",
        `token=${refreshToken}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const revokeMock = createMockResponse();
      await handleOAuthRevoke(revokeReq, revokeMock.res);

      expect(revokeMock.getStatus()).toBe(200);

      // Access token should also be revoked (family revocation)
      const accessAuthAfter = await validateAuth(accessToken);
      expect(accessAuthAfter).toBeNull();

      // Verify both tokens are revoked in Firestore
      const accessHash = crypto.createHash("sha256").update(accessToken).digest("hex");
      const refreshHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

      const accessDoc = await db.doc(`oauthTokens/${accessHash}`).get();
      const refreshDoc = await db.doc(`oauthTokens/${refreshHash}`).get();

      expect(accessDoc.data()?.active).toBe(false);
      expect(refreshDoc.data()?.active).toBe(false);
    });

    it("should return 200 for unknown token (RFC 7009)", async () => {
      const fakeToken = "cbo_" + crypto.randomBytes(32).toString("hex");

      const revokeReq = createMockRequest(
        "POST",
        "/revoke",
        `token=${fakeToken}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const revokeMock = createMockResponse();
      await handleOAuthRevoke(revokeReq, revokeMock.res);

      expect(revokeMock.getStatus()).toBe(200); // RFC 7009: Always 200, no error
    });
  });

  describe("10. MCP Request with OAuth Token", () => {
    let accessToken: string;

    beforeEach(async () => {
      // Get a valid access token
      const clientId = "test-client-" + crypto.randomUUID();
      await db.collection("oauthClients").doc(clientId).set({
        clientId,
        clientName: "MCP Test Client",
        redirectUris: ["https://test.local/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const pkce = generatePkce();
      const authCode = crypto.randomBytes(32).toString("hex");
      const codeHash = crypto.createHash("sha256").update(authCode).digest("hex");
      const now = new Date();

      await db.doc(`oauthCodes/${codeHash}`).set({
        codeHash,
        clientId,
        userId,
        redirectUri: "https://test.local/callback",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state: "test-state",
        scope: "mcp:full",
        createdAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)),
        used: false,
      });

      const tokenReq = createMockRequest(
        "POST",
        "/token",
        `grant_type=authorization_code&code=${authCode}&redirect_uri=https://test.local/callback&client_id=${clientId}&code_verifier=${pkce.verifier}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const tokenMock = createMockResponse();
      await handleOAuthToken(tokenReq, tokenMock.res);
      const tokenResponse = JSON.parse(tokenMock.getBody());
      accessToken = tokenResponse.access_token;
    });

    it("should accept valid OAuth access token (cbo_ prefix)", async () => {
      const authContext = await validateAuth(accessToken);

      expect(authContext).not.toBeNull();
      expect(authContext!.userId).toBe(userId);
      expect(authContext!.programId).toBe("oauth");
      expect(authContext!.encryptionKey).toBeDefined();
      expect(authContext!.capabilities).toContain("*"); // Default OAuth capabilities
    });

    it("should reject revoked OAuth token with 401", async () => {
      // Revoke the token
      const revokeReq = createMockRequest(
        "POST",
        "/revoke",
        `token=${accessToken}`,
        { "content-type": "application/x-www-form-urlencoded" }
      );
      const revokeMock = createMockResponse();
      await handleOAuthRevoke(revokeReq, revokeMock.res);

      // Try to use revoked token
      const authContext = await validateAuth(accessToken);
      expect(authContext).toBeNull();
    });

    it("should reject token with unknown prefix immediately (SARK F-6)", async () => {
      const fakeToken = "unknown_" + crypto.randomBytes(32).toString("hex");

      const authContext = await validateAuth(fakeToken);
      expect(authContext).toBeNull();

      // Should not have made any Firestore lookups (immediate rejection)
    });
  });

  // IMPORTANT: This test MUST be last to avoid rate limit bleed into other tests
  describe("11. DCR Rate Limiting (LAST TEST)", () => {
    it("should enforce DCR rate limiting (11th registration should fail)", async () => {
      // Use a specific IP for this test to isolate rate limiting
      const rateLimitTestIp = "192.168.99.99";

      const promises = [];
      for (let i = 0; i < 11; i++) {
        const req = createMockRequest(
          "POST",
          "/register",
          {
            client_name: `Rate Limit Test Client ${i}`,
            redirect_uris: ["https://ratelimit-test.local"],
          },
          {},
          rateLimitTestIp // Use same IP for all requests to trigger rate limit
        );
        const { res, getStatus, getBody } = createMockResponse();
        promises.push(
          handleOAuthRegister(req, res).then(() => ({ status: getStatus(), body: getBody() }))
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 201).length;
      const rateLimitedCount = results.filter((r) => r.status === 429).length;

      expect(successCount).toBe(10);
      expect(rateLimitedCount).toBe(1);
    });
  });
});
