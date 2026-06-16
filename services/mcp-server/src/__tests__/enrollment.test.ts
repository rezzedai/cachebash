/**
 * /enroll endpoint tests — SARK G-4 controls
 *
 * Verifies all 11 controls from cerebro/enrollment/DESIGN.md.
 * F-368-1: jest (not vitest) — mirrors portal-owner-send-message.test.ts pattern.
 * F-368-2: MAX_TTL_MS cap enforced at redeem.
 * F-368-3: cb_key capabilities are tier-scoped (Trial/Standard/Dedicated).
 */

import * as crypto from "crypto";
import { Readable } from "stream";
import http from "http";
import { enrollHandler } from "../modules/enrollment.js";

// --- Firestore mock ---
const mockDocData: Record<string, any> = {};
const mockTxUpdates: Record<string, any> = {};
const mockTxSets: Record<string, any> = {};

const mockTransaction = {
  get: jest.fn(async (ref: any) => ({
    exists: ref._path in mockDocData,
    data: () => mockDocData[ref._path],
  })),
  set: jest.fn((ref: any, data: any) => { mockTxSets[ref._path] = data; }),
  update: jest.fn((ref: any, data: any) => { mockTxUpdates[ref._path] = data; }),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: () => ({
    doc: (path: string) => ({ _path: path }),
    runTransaction: async (fn: (tx: any) => Promise<void>) => fn(mockTransaction),
  }),
}));

// Restore mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockDocData).forEach(k => delete mockDocData[k]);
  Object.keys(mockTxUpdates).forEach(k => delete mockTxUpdates[k]);
  Object.keys(mockTxSets).forEach(k => delete mockTxSets[k]);
});

// Helper: sha256hex
function sha256hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Helper: mock enrollment doc
function seedEnrollment(token: string, overrides: Partial<any> = {}) {
  const h = sha256hex(token);
  mockDocData[`enrollments/${h}`] = {
    tenantId: "tenant-sayf",
    tier: "standard",
    status: "pending",
    createdAt: { toDate: () => new Date(Date.now() - 60_000) },
    expiresAt: { toDate: () => new Date(Date.now() + 3600_000) },
    ...overrides,
  };
  return h;
}

// Helper: simulate a POST /enroll request
async function callEnroll(body: unknown, env: Record<string, string> = { LITE_URL: "https://lite.cerebro.cachebash.dev" }) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);

  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    Readable.from(chunks),
    { method: "POST", headers: {} }
  ) as unknown as http.IncomingMessage;

  let statusCode = 0;
  let responseBody = "";
  const res = {
    writeHead: (s: number) => { statusCode = s; },
    end: (b: string) => { responseBody = b; },
  } as unknown as http.ServerResponse;

  await enrollHandler(req, res);

  Object.assign(process.env, originalEnv);

  return { status: statusCode, body: JSON.parse(responseBody) };
}

// --- Tests ---

describe("POST /enroll — SARK G-4 controls", () => {
  it("G-4-1/2/3/6/7/8: happy path — returns {lite_url, cb_key}, marks consumed, stores key hash", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token);

    const { status, body } = await callEnroll({ token });

    expect(status).toBe(200);
    // G-4 control 7: response EXACTLY {lite_url, cb_key}
    expect(Object.keys(body).sort()).toEqual(["cb_key", "lite_url"]);
    expect(body.lite_url).toBe("https://lite.cerebro.cachebash.dev");
    // G-4 control 1: cb_ prefix, 64-char hex suffix (32 bytes)
    expect(body.cb_key).toMatch(/^cb_[0-9a-f]{64}$/);

    // G-4 control 3: transaction consumed the doc
    const tokenHash = sha256hex(token);
    expect(mockTxUpdates[`enrollments/${tokenHash}`].status).toBe("consumed");
    expect(mockTxUpdates[`enrollments/${tokenHash}`].consumedAt).toBeDefined();

    // G-4 control 8: keyHash stored (sha256 of key), never raw key
    const keyHash = mockTxUpdates[`enrollments/${tokenHash}`].keyHash;
    expect(keyHash).toBe(sha256hex(body.cb_key));
    expect(keyHash).toHaveLength(64);

    // G-4 control 2: keyIndex stores hash only
    const keyDoc = mockTxSets[`keyIndex/${keyHash}`];
    expect(keyDoc).toBeDefined();
    // raw key is NOT stored anywhere in the keyIndex doc
    expect(JSON.stringify(keyDoc)).not.toContain(body.cb_key);

    // G-4 control 10: no hub-scoped caps
    expect(keyDoc.programId).toBe("cerebro");
    expect(keyDoc.userId).toBe("tenant-sayf");
  });

  it("G-4-4: consumed token returns identical 400 — no oracle (same response as invalid)", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { status: "consumed" });

    const { status, body } = await callEnroll({ token });

    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_or_expired_enrollment" });
  });

  it("G-4-4: expired token returns identical 400 — no oracle", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { expiresAt: { toDate: () => new Date(Date.now() - 1000) } });

    const { status, body } = await callEnroll({ token });

    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_or_expired_enrollment" });
  });

  it("G-4-4: non-existent token returns identical 400 — no oracle", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    // No doc seeded

    const { status, body } = await callEnroll({ token });

    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_or_expired_enrollment" });
  });

  it("G-4-4: oracle check — consumed, expired, and invalid all return byte-identical response", async () => {
    const t1 = crypto.randomBytes(32).toString("hex");
    const t2 = crypto.randomBytes(32).toString("hex");
    const t3 = crypto.randomBytes(32).toString("hex");
    seedEnrollment(t1, { status: "consumed" });
    seedEnrollment(t2, { expiresAt: { toDate: () => new Date(0) } });
    // t3: no doc

    const [r1, r2, r3] = await Promise.all([
      callEnroll({ token: t1 }),
      callEnroll({ token: t2 }),
      callEnroll({ token: t3 }),
    ]);

    expect(r1.body).toEqual(r2.body);
    expect(r2.body).toEqual(r3.body);
    expect(r1.status).toBe(400);
  });

  it("F-368-2: token with storedExpiresAt > 24h from createdAt is rejected (MAX_TTL cap at redeem)", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    // createdAt = 25 hours ago; storedExpiresAt = createdAt + 48h (violates 24h cap)
    const createdAt = new Date(Date.now() - 25 * 3600_000);
    const storedExpiresAt = new Date(createdAt.getTime() + 48 * 3600_000);
    seedEnrollment(token, {
      createdAt: { toDate: () => createdAt },
      expiresAt: { toDate: () => storedExpiresAt },
    });

    const { status, body } = await callEnroll({ token });

    // effectiveExpiry = min(storedExpiresAt, createdAt + 24h) = createdAt + 24h = 1h ago → rejected
    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_or_expired_enrollment" });
  });

  it("F-368-2: token within 24h cap is accepted even if storedExpiresAt is far in future", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    // createdAt = 1 hour ago; storedExpiresAt = createdAt + 48h; effectiveExpiry = createdAt + 24h = 23h from now
    const createdAt = new Date(Date.now() - 1 * 3600_000);
    const storedExpiresAt = new Date(createdAt.getTime() + 48 * 3600_000);
    seedEnrollment(token, {
      createdAt: { toDate: () => createdAt },
      expiresAt: { toDate: () => storedExpiresAt },
    });

    const { status } = await callEnroll({ token });

    expect(status).toBe(200);
  });

  it("F-368-3: trial tier — capabilities are trial-scoped (no wildcard)", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { tier: "trial" });

    const { status } = await callEnroll({ token });

    expect(status).toBe(200);
    const keyDoc = Object.values(mockTxSets)[0] as any;
    const caps: string[] = keyDoc.capabilities;
    expect(caps).not.toContain("*");
    expect(caps).toContain("dispatch.read");
    expect(caps).toContain("dispatch.write");
    // trial does NOT get metrics, fleet, trace, sprint, signal
    expect(caps).not.toContain("metrics.read");
    expect(caps).not.toContain("sprint.read");
  });

  it("F-368-3: standard tier — capabilities are standard-scoped (no wildcard)", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { tier: "standard" });

    const { status } = await callEnroll({ token });

    expect(status).toBe(200);
    const keyDoc = Object.values(mockTxSets)[0] as any;
    const caps: string[] = keyDoc.capabilities;
    expect(caps).not.toContain("*");
    expect(caps).toContain("metrics.read");
    expect(caps).toContain("sprint.read");
    expect(caps).toContain("trace.read");
  });

  it("F-368-3: dedicated tier — capabilities include wildcard (*)", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { tier: "dedicated" });

    const { status } = await callEnroll({ token });

    expect(status).toBe(200);
    const keyDoc = Object.values(mockTxSets)[0] as any;
    expect(keyDoc.capabilities).toEqual(["*"]);
  });

  it("G-4-7: response contains no topology, no internal IDs beyond lite_url+cb_key", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token);

    const { status, body } = await callEnroll({ token });

    expect(status).toBe(200);
    const keys = Object.keys(body);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("lite_url");
    expect(keys).toContain("cb_key");
    // No tenantId, programId, tokenHash, userId, keyHash, capabilities, etc.
    expect(keys).not.toContain("tenantId");
    expect(keys).not.toContain("keyHash");
    expect(keys).not.toContain("programId");
  });

  it("G-4-8: raw cb_key is never written to enrollment doc or keyIndex doc", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token);

    const { body } = await callEnroll({ token });
    const rawKey = body.cb_key;

    // Scan ALL Firestore writes for raw key appearance
    const allWrites = JSON.stringify({ sets: mockTxSets, updates: mockTxUpdates });
    expect(allWrites).not.toContain(rawKey);
    expect(allWrites).not.toContain(token); // token also never stored raw
  });

  it("G-4-9: no cross-tenant mint — keyIndex doc scoped to enrollment tenantId only", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token, { tenantId: "tenant-sayf" });

    await callEnroll({ token });

    const keyDocs = Object.values(mockTxSets);
    for (const doc of keyDocs) {
      expect((doc as any).userId).toBe("tenant-sayf");
    }
  });

  it("G-4-10: minted key is tenant-scoped (cerebro programId), never hub-scoped", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    seedEnrollment(token);

    await callEnroll({ token });

    const keyDoc = Object.values(mockTxSets)[0] as any;
    expect(keyDoc.programId).toBe("cerebro");
    // Hub-scoped keys would have programId 'iso', 'basher', '*', etc.
    expect(["iso", "basher", "vector", "alan", "sark"]).not.toContain(keyDoc.programId);
  });

  it("returns 400 for missing token field", async () => {
    const { status, body } = await callEnroll({});
    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_or_expired_enrollment" });
  });

  it("returns 405 for non-POST methods", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    let statusCode = 0;
    const res = {
      writeHead: (s: number) => { statusCode = s; },
      end: () => {},
    } as unknown as http.ServerResponse;
    await enrollHandler(req, res);
    expect(statusCode).toBe(405);
  });
});
