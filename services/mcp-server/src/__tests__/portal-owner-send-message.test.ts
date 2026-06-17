/**
 * Tests for POST /v1/relay/messages — portal owner send-message via server REST.
 * Identity Sovereignty inv.6: source is server-derived from Firebase owner token;
 * client cannot impersonate a program ID.
 *
 * Test structure:
 *   1. Handler-level tests — sendMessageHandler behavior (F2: source derivation, impersonation)
 *   2. Route-level integration tests — real route handler via HTTP (F3: try/catch, F4: guards)
 */

import type { AuthContext } from "../auth/authValidator";
import { sendMessageHandler } from "../modules/relay";
import * as http from "http";
import { createRestRouter } from "../transport/rest";

// --- Module mocks ---

let capturedRelayDoc: Record<string, unknown> = {};

const mockDocRef = {
  id: "relay-doc-id",
  set: jest.fn(async () => {}),
  get: jest.fn(async () => ({ exists: false })),
};

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => mockDocRef),
    add: jest.fn(async (data: Record<string, unknown>) => {
      capturedRelayDoc = data;
      return { id: "relay-doc-id" };
    }),
  })),
  doc: jest.fn(() => mockDocRef),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));

jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((_claimed: string, auth: AuthContext) => auth.programId),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "mock-corr-id"),
  createAuditLogger: jest.fn(() => ({ log: jest.fn(), error: jest.fn() })),
}));

jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
}));

jest.mock("../modules/analytics.js", () => ({
  emitAnalyticsEvent: jest.fn(),
}));

jest.mock("../config/compliance.js", () => ({
  getComplianceConfig: jest.fn(() => ({
    idempotencyKey: { enforcement: "none" },
    ackAudit: { enabled: false },
  })),
}));

jest.mock("../config/programs.js", () => ({
  isGroupTarget: jest.fn(() => false),
  PROGRAM_GROUPS: {},
  isProgramRegistered: jest.fn(async () => true),
}));

jest.mock("../modules/programRegistry.js", () => ({
  resolveTargetsAsync: jest.fn(async (_uid: string, target: string) => [target]),
  resolveGroupAsync: jest.fn(async () => []),
  listGroupsAsync: jest.fn(async () => []),
}));

jest.mock("../types/relay-schemas.js", () => ({
  validatePayload: jest.fn(() => ({ valid: true })),
}));

jest.mock("../types/relay.js", () => ({
  RELAY_DEFAULT_TTL_SECONDS: 86400,
}));

jest.mock("../modules/ack-compliance.js", () => ({
  logDirective: jest.fn(),
  markDirectiveAcknowledged: jest.fn(),
}));

jest.mock("../utils/trace.js", () => ({
  generateSpanId: jest.fn(() => "mock-span"),
}));

// Additional mocks needed by createRestRouter (not used by sendMessageHandler directly)
jest.mock("../auth/authValidator.js", () => ({
  validateAuth: jest.fn(),
}));
jest.mock("../tools.js", () => ({
  TOOL_HANDLERS: {},
  TOOL_DEFINITIONS: [],
}));
jest.mock("../modules/ledger.js", () => ({
  logToolCall: jest.fn(),
}));
jest.mock("../modules/trace.js", () => ({
  traceToolCall: jest.fn(),
}));
jest.mock("../middleware/rateLimiter.js", () => ({
  enforceRateLimit: jest.fn(() => ({ allowed: true })),
  checkAuthRateLimit: jest.fn(() => true),
}));
jest.mock("../middleware/sessionCompliance.js", () => ({
  checkSessionCompliance: jest.fn(async () => ({ allowed: true })),
  resetTransportCompliance: jest.fn(),
}));
jest.mock("../middleware/pricingEnforce.js", () => ({
  checkPricing: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("../middleware/usage.js", () => ({
  incrementUsage: jest.fn(),
}));
jest.mock("../config/access-tiers.js", () => ({
  ADMIN_READERS: [],
  ADMIN_PROGRAMS: [],
}));
jest.mock("../config/constants.js", () => ({
  CONSTANTS: { limits: { maxBodySizeBytes: 65536 } },
}));
jest.mock("../tools/tool-aliases.js", () => ({
  resolveToolAlias: jest.fn((name: string) => name),
}));
jest.mock("../modules/openapi.js", () => ({
  generateOpenApiSpec: jest.fn(() => ({})),
}));
jest.mock("../modules/dream.js", () => ({
  dreamPeekHandler: jest.fn(),
  dreamActivateHandler: jest.fn(),
}));
jest.mock("../modules/gsp.js", () => ({
  gspListNamespacesHandler: jest.fn(),
  gspResolveHandler: jest.fn(),
}));

// --- Auth fixtures ---

function ownerAuth(): AuthContext {
  return {
    userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2",
    apiKeyHash: "firebase:7viFKVtl5lgzguhFoZlnYYrqeDG2",
    encryptionKey: Buffer.from("abc"),
    programId: "flynn" as any,
    keyProgramId: "flynn" as any,
    capabilities: ["*"],
    rateLimitTier: "paid",
  };
}

function mobileAuth(): AuthContext {
  return {
    userId: "unknown-uid",
    apiKeyHash: "firebase:unknown-uid",
    encryptionKey: Buffer.from("abc"),
    programId: "mobile" as any,
    keyProgramId: "mobile" as any,
    capabilities: [],
    rateLimitTier: "free",
  };
}

function apiKeyAuth(): AuthContext {
  return {
    userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2",
    apiKeyHash: "cb_abc123",
    encryptionKey: Buffer.from("abc"),
    programId: "flynn" as any,
    keyProgramId: "flynn" as any,
    capabilities: ["*"],
    rateLimitTier: "paid",
  };
}

// --- 1. Handler-level tests ---

describe("portal owner send-message — handler level", () => {
  beforeEach(() => {
    capturedRelayDoc = {};
    jest.clearAllMocks();
    // Restore default verifySource mock (returns programId — no mismatch)
    const { verifySource } = require("../middleware/gate.js");
    verifySource.mockImplementation((_claimed: string, auth: AuthContext) => auth.programId);
  });

  it("writes relay doc with source=flynn when owner sends a message", async () => {
    const auth = ownerAuth();
    const result = await sendMessageHandler(auth, {
      source: auth.programId,
      target: "iso",
      message: "Test message from portal owner",
      message_type: "DIRECTIVE",
      priority: "normal",
    });

    const text = result?.content?.[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(capturedRelayDoc.source).toBe("flynn");
    expect(capturedRelayDoc.target).toBe("iso");
    expect(capturedRelayDoc.status).toBe("pending");
  });

  it("real verifySource rejects impersonation: keyProgramId=basher claiming source=iso", async () => {
    // Unmock verifySource for this test — use the real implementation
    const { verifySource } = jest.requireActual("../middleware/gate.js") as { verifySource: typeof import("../middleware/gate.js").verifySource };
    require("../middleware/gate.js").verifySource.mockImplementationOnce(
      (claimed: string, auth: AuthContext, endpoint: "mcp" | "admin" | "rest") => verifySource(claimed, auth, endpoint)
    );

    const basherAuth: AuthContext = {
      userId: "7viFKVtl5lgzguhFoZlnYYrqeDG2",
      apiKeyHash: "firebase:7viFKVtl5lgzguhFoZlnYYrqeDG2",
      encryptionKey: Buffer.from("abc"),
      programId: "basher" as any,
      keyProgramId: "basher" as any,
      capabilities: ["*"],
      rateLimitTier: "paid",
    };

    await expect(
      sendMessageHandler(basherAuth, {
        source: "iso",
        target: "basher",
        message: "Impersonation attempt",
        message_type: "DIRECTIVE",
      })
    ).rejects.toThrow("Source mismatch");
  });
});

// --- 2. Route-level integration tests (F3 + F4) ---
// These drive the real route handler in rest.ts via HTTP,
// covering branches that handler-level tests cannot reach.

describe("POST /v1/relay/messages — route-level guards (HTTP)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = http.createServer(createRestRouter());
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default verifySource mock
    const { verifySource } = require("../middleware/gate.js");
    verifySource.mockImplementation((_claimed: string, auth: AuthContext) => auth.programId);
  });

  function makeRequest(auth: AuthContext, body: object = {}): Promise<{ status: number; data: Record<string, unknown> }> {
    const { validateAuth } = require("../auth/authValidator.js");
    validateAuth.mockResolvedValueOnce(auth);

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ target: "iso", message: "test", message_type: "DIRECTIVE", ...body });
      const options = {
        method: "POST",
        headers: {
          "Authorization": "Bearer test-token",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };
      const req = http.request(new URL("/v1/relay/messages", baseUrl), options, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch (e) { reject(e); }
        });
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  it("(a) rejects cb_ API key with 403 PORTAL_OWNER_ONLY", async () => {
    const result = await makeRequest(apiKeyAuth());
    expect(result.status).toBe(403);
    expect((result.data as any).error).toBe("PORTAL_OWNER_ONLY");
  });

  it("(b) rejects mobile Firebase token with 403 OWNER_REQUIRED", async () => {
    const result = await makeRequest(mobileAuth());
    expect(result.status).toBe(403);
    expect((result.data as any).error).toBe("OWNER_REQUIRED");
  });

  it("(c) maps SOURCE_MISMATCH throw from sendMessageHandler to 403 not 500 (F3)", async () => {
    // verifySource throws SOURCE_MISMATCH → route try/catch must return 403, not 500
    const { verifySource } = require("../middleware/gate.js");
    verifySource.mockImplementationOnce(() => {
      throw new Error('Source mismatch: key belongs to "basher", claimed "iso". Each program must use its own API key.');
    });

    const result = await makeRequest(ownerAuth());
    expect(result.status).toBe(403);
    expect((result.data as any).error).toBe("SOURCE_MISMATCH");
  });

  it("(d) owner with keyProgramId derives source correctly — F2 keyProgramId takes precedence", async () => {
    // ownerAuth has keyProgramId="flynn"; relay doc should be attributed to "flynn"
    const result = await makeRequest(ownerAuth());
    expect(result.status).toBe(201);
    expect(capturedRelayDoc.source).toBe("flynn");
  });
});
