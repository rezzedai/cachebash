/**
 * Tests for POST /v1/relay/messages — owner portal send-message endpoint.
 *
 * Identity Sovereignty inv.6: the REST route strips any client-supplied source
 * and injects auth.programId server-side. These tests verify:
 *   1. Relay doc is written with source = auth.programId (not client input).
 *   2. Client-supplied program source is rejected at the handler level (verifySource).
 *   3. Required fields (target, message_type, message) are written correctly.
 */
import type { AuthContext } from "../auth/authValidator";
import { sendMessageHandler } from "../modules/relay";
import { verifySource } from "../middleware/gate";

let lastRelayDoc: Record<string, unknown> = {};

const mockDocRef = {
  id: "msg-id-1",
  set: jest.fn(async () => {}),
  get: jest.fn(async () => ({ exists: false })),
};

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => mockDocRef),
    add: jest.fn(async (data: Record<string, unknown>) => {
      lastRelayDoc = data;
      return { id: "msg-id-1" };
    }),
  })),
  doc: jest.fn(() => mockDocRef),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));

// Use the REAL verifySource so impersonation rejection is tested without mocks.
jest.mock("../middleware/gate.js", () => {
  const real = jest.requireActual("../middleware/gate.js");
  return {
    ...real,
    isAdmin: jest.fn(() => false),
    logAudit: jest.fn(),
    generateCorrelationId: jest.fn(() => "corr-1"),
  };
});

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
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
jest.mock("../../src/modules/programRegistry.js", () => ({
  resolveTargetsAsync: jest.fn(async (_uid: string, target: string) => [target]),
  resolveGroupAsync: jest.fn(async () => []),
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

function flynnAuth(): AuthContext {
  return {
    userId: "u-flynn",
    apiKeyHash: "firebase:uid-flynn",
    encryptionKey: Buffer.from("abc"),
    programId: "flynn" as any,
    keyProgramId: "flynn" as any,
    capabilities: ["relay:write"],
    rateLimitTier: "standard",
  };
}

describe("relay owner send-message — identity sovereignty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastRelayDoc = {};
  });

  it("succeeds when source matches auth.programId (flynn)", async () => {
    // Simulates the route injecting source: auth.programId after stripping client input.
    const result = await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "basher",
      message_type: "DIRECTIVE",
      message: "Investigate BUG-005",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe("msg-id-1");
  });

  it("writes relay doc with source=flynn (server-derived identity)", async () => {
    await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "iso",
      message_type: "QUERY",
      message: "What is the fleet status?",
    });
    expect(lastRelayDoc.source).toBe("flynn");
    expect(lastRelayDoc.target).toBe("iso");
    expect(lastRelayDoc.message_type).toBe("QUERY");
  });

  it("writes required relay doc fields", async () => {
    await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "vector",
      message_type: "PING",
      message: "ping",
    });
    expect(lastRelayDoc.payload).toBe("ping"); // relay doc uses payload (ADR-014), not message
    expect(lastRelayDoc.status).toBe("pending");
    expect(lastRelayDoc.deliveryAttempts).toBe(0);
    expect(lastRelayDoc.createdAt).toBe("MOCK_TIMESTAMP");
  });

  it("rejects impersonation: source=basher with flynn credentials", async () => {
    // verifySource (real) must throw when claimed source !== credential identity.
    // The route strips client source before this ever runs, but the handler
    // enforces it as a second line of defence.
    await expect(
      sendMessageHandler(flynnAuth(), {
        source: "basher",
        target: "iso",
        message_type: "DIRECTIVE",
        message: "Impersonation attempt",
      })
    ).rejects.toThrow(/Source mismatch/);
  });

  it("rejects impersonation: source=iso with flynn credentials", async () => {
    await expect(
      sendMessageHandler(flynnAuth(), {
        source: "iso",
        target: "basher",
        message_type: "STATUS",
        message: "Impersonation attempt",
      })
    ).rejects.toThrow(/Source mismatch/);
  });

  it("accepts priority and context from client body", async () => {
    await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "basher",
      message_type: "QUERY",
      message: "Status check",
      priority: "high",
      context: "portal-initiated",
    });
    expect(lastRelayDoc.priority).toBe("high");
    expect(lastRelayDoc.context).toBe("portal-initiated");
  });
});
