/**
 * Integration Test: WS-3 Boundary Circuit Breaker — REST direct-handler routes
 *
 * SARK 2-KILL finding: several REST routes invoked their mutation handler
 * directly (gspResolveHandler, dreamActivateHandler, sendMessageHandler, and
 * a raw Firestore batch-write for mark_read), bypassing callTool() and
 * therefore the breaker entirely — unlike every other mutating route, which
 * already routes through callTool() and inherits the enforcement added in
 * circuitBreaker.ts.
 *
 * This proves the fix for POST /v1/gsp/proposals/:id/resolve end-to-end
 * against the real Firestore emulator and the real REST route (not a mocked
 * breaker): the N+1th resolve call in the window is denied, and a tenant
 * with no ceilings doc fails closed. See circuit-breaker.test.ts for the
 * dedicated unit coverage of checkCircuitBreaker's window math, and
 * portal-owner-send-message.test.ts for POST /v1/relay/messages route-level
 * coverage of the same fix.
 */

import * as crypto from "crypto";
import * as http from "http";
import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

// github-sync (pulled in via transport/rest -> tools) imports ESM-only
// @octokit/rest, which ts-jest does not transform — mock it out (same as
// relay-delivery.test.ts).
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

// Point the module under test at the emulator-backed Firestore instance
// instead of the production firebase/client.ts singleton.
jest.mock("../../firebase/client.js", () => ({
  getFirestore: () => getTestFirestoreLazy(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}));

function getTestFirestoreLazy(): admin.firestore.Firestore {
  return getTestFirestore();
}

// checkCircuitBreaker fires a signal alert on every denial as a deliberate
// fire-and-forget (see circuitBreaker.ts emitBreakerAlert) — not awaited by
// production code, so it can still be in flight after this test file's HTTP
// server closes and Jest tears down the module environment. Not the subject
// of this suite; stub it out.
jest.mock("../../modules/signal.js", () => ({
  sendAlertHandler: jest.fn(async () => ({ content: [{ text: "{}" }] })),
}));

import { resetCircuitBreakerState } from "../../middleware/circuitBreaker";
import { createRestRouter } from "../../transport/rest";

describe("WS-3 REST route enforcement — POST /v1/gsp/proposals/:id/resolve", () => {
  let db: admin.firestore.Firestore;
  let userId: string;
  let apiKey: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = getTestFirestore();
    server = http.createServer(createRestRouter());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  beforeEach(async () => {
    await clearFirestoreData();
    resetCircuitBreakerState();

    const testUser = await seedTestUser("test-org-breaker-rest");
    userId = testUser.userId;

    // Real cb_ API key via keyIndex — drives the actual validateApiKey path,
    // not a mocked auth context.
    apiKey = `cb_test_${crypto.randomBytes(8).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    await db.doc(`keyIndex/${keyHash}`).set({
      userId,
      programId: "scalar",
      capabilities: ["gsp.write"],
      active: true,
    });
  });

  async function resolveProposal(proposalId = "does-not-exist"): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}/v1/gsp/proposals/${proposalId}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", reasoning: "test" }),
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it("the N+1th resolve call in the window is denied with the typed breaker error", async () => {
    await db.doc(`tenants/${userId}/_meta/ceilings`).set({
      perKeyLimit: 1,
      orgLimit: 100,
      windowMs: 60_000,
      paused: false,
    });

    // 1st call consumes the single slot. The proposal doesn't exist so the
    // handler itself reports not-found (400) — this proves the call reached
    // the handler at all, i.e. the breaker allowed it through.
    const first = await resolveProposal();
    expect(first.status).toBe(400);

    // 2nd call (N+1th): must be denied by the breaker BEFORE the handler
    // runs — this is exactly the bypass the SARK panel flagged.
    const second = await resolveProposal();
    expect(second.status).toBe(429);
    expect(second.body?.error?.code).toBe("CEILING_KEY_EXCEEDED");
  });

  it("fails closed: denies the resolve call when the tenant has no ceilings doc", async () => {
    await db.doc(`tenants/${userId}/_meta/ceilings`).delete();

    const res = await resolveProposal();
    expect(res.status).toBe(503);
    expect(res.body?.error?.code).toBe("CEILING_CONFIG_UNAVAILABLE");
  });
});
