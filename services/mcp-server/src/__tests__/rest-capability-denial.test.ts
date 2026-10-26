/**
 * REST capability denial maps to 403 INSUFFICIENT_CAPABILITY (C1ASwIOG).
 *
 * callTool() and enforceBreaker() threw a plain Error on a capability miss, so
 * the REST catch-all answered 500 INTERNAL_ERROR. Emulator-free: the real
 * capabilities module and the real REST router run against mocked Firestore,
 * auth and tool handlers, so the default `jest` config (and CI) executes it.
 */

import type { AuthContext } from "../auth/authValidator";
import * as http from "http";
import { createRestRouter } from "../transport/rest";
import { validateAuth } from "../auth/authValidator.js";

const mockBatch = { update: jest.fn(), commit: jest.fn(async () => {}) };
const mockDb = {
  collection: jest.fn(() => ({ doc: jest.fn(() => ({})) })),
  doc: jest.fn(() => ({})),
  batch: jest.fn(() => mockBatch),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));
jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((_c: string, auth: AuthContext) => auth.programId),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "mock-corr-id"),
  createAuditLogger: jest.fn(() => ({ log: jest.fn(), error: jest.fn() })),
}));
jest.mock("../auth/authValidator.js", () => ({ validateAuth: jest.fn() }));
jest.mock("../tools.js", () => ({
  TOOL_HANDLERS: {
    dispatch_get_tasks: jest.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ success: true, tasks: [] }) }] })),
  },
  TOOL_DEFINITIONS: [],
}));
jest.mock("../modules/ledger.js", () => ({ logToolCall: jest.fn() }));
jest.mock("../modules/trace.js", () => ({ traceToolCall: jest.fn() }));
jest.mock("../middleware/rateLimiter.js", () => ({
  enforceRateLimit: jest.fn(() => ({ allowed: true })),
  checkAuthRateLimit: jest.fn(() => true),
}));
jest.mock("../middleware/sessionCompliance.js", () => ({
  checkSessionCompliance: jest.fn(async () => ({ allowed: true })),
  resetTransportCompliance: jest.fn(),
}));
jest.mock("../middleware/pricingEnforce.js", () => ({ checkPricing: jest.fn(async () => ({ allowed: true })) }));
jest.mock("../middleware/usage.js", () => ({ incrementUsage: jest.fn(), incrementSeatUsage: jest.fn() }));
jest.mock("../middleware/circuitBreaker.js", () => ({
  checkCircuitBreaker: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("../modules/openapi.js", () => ({ generateOpenApiSpec: jest.fn(() => ({})) }));
jest.mock("../modules/dream.js", () => ({ dreamPeekHandler: jest.fn(), dreamActivateHandler: jest.fn() }));
jest.mock("../modules/gsp.js", () => ({ gspListNamespacesHandler: jest.fn(), gspResolveHandler: jest.fn() }));

function authWith(capabilities: string[]): AuthContext {
  return {
    userId: "uid-1",
    apiKeyHash: "cb_abc123",
    encryptionKey: Buffer.from("abc"),
    programId: "scalar" as any,
    keyProgramId: "scalar" as any,
    capabilities,
    rateLimitTier: "paid",
  };
}

describe("REST capability denial", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(createRestRouter());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  async function call(method: string, path: string, caps: string[], body?: unknown): Promise<{ status: number; body: any }> {
    (validateAuth as jest.Mock).mockResolvedValue(authWith(caps));
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: "Bearer cb_test", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("callTool path: GET /v1/tasks without dispatch.read returns 403 INSUFFICIENT_CAPABILITY", async () => {
    const res = await call("GET", "/v1/tasks", ["fleet.read"]);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INSUFFICIENT_CAPABILITY");
    expect(res.body.error.message).toContain('requires "dispatch.read"');
  });

  it("enforceBreaker path: mark_read without relay.write returns 403 INSUFFICIENT_CAPABILITY", async () => {
    const res = await call("POST", "/v1/messages/mark_read", ["fleet.read"], { messageIds: ["m1"] });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INSUFFICIENT_CAPABILITY");
    expect(res.body.error.message).toContain('requires "relay.write"');
  });

  it("a key holding the capability is not denied on GET /v1/tasks", async () => {
    const res = await call("GET", "/v1/tasks", ["dispatch.read"]);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("a key holding the capability is not denied on mark_read", async () => {
    const res = await call("POST", "/v1/messages/mark_read", ["relay.write"], { messageIds: ["m1"] });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });
});
