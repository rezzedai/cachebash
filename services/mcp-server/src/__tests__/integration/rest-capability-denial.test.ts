/**
 * Integration Test: REST capability denial maps to 403 INSUFFICIENT_CAPABILITY
 *
 * callTool() and enforceBreaker() threw a plain Error on a capability miss, so
 * the REST dispatcher's catch-all answered 500 INTERNAL_ERROR. A key lacking
 * the tool's capability is an authorization failure, not a server fault.
 * Covers both throw sites: callTool (POST /v1/tasks/:id/claim) and
 * enforceBreaker (POST /v1/messages/mark_read).
 */

import * as crypto from "crypto";
import * as http from "http";
import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

jest.mock("../../firebase/client.js", () => ({
  getFirestore: () => getTestFirestore(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}));

jest.mock("../../modules/signal.js", () => ({
  sendAlertHandler: jest.fn(async () => ({ content: [{ text: "{}" }] })),
}));

import { resetCircuitBreakerState } from "../../middleware/circuitBreaker";
import { createRestRouter } from "../../transport/rest";

describe("REST capability denial", () => {
  let db: admin.firestore.Firestore;
  let apiKey: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = getTestFirestore();
    server = http.createServer(createRestRouter());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  beforeEach(async () => {
    await clearFirestoreData();
    resetCircuitBreakerState();
    const { userId } = await seedTestUser("test-org-cap-denial");
    apiKey = `cb_test_${crypto.randomBytes(8).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    await db.doc(`keyIndex/${keyHash}`).set({
      userId,
      programId: "scalar",
      capabilities: ["audit.read"],
      active: true,
    });
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("callTool path: claim without dispatch.write returns 403 INSUFFICIENT_CAPABILITY", async () => {
    const res = await post("/v1/tasks/some-task/claim", {});
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("INSUFFICIENT_CAPABILITY");
    expect(res.body?.error?.message).toContain("Insufficient capability");
  });

  it("enforceBreaker path: mark_read without the required capability returns 403 INSUFFICIENT_CAPABILITY", async () => {
    const res = await post("/v1/messages/mark_read", { messageIds: ["m1"] });
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("INSUFFICIENT_CAPABILITY");
  });
});
