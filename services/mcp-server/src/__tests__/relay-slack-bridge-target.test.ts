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
  isProgramRegistered: jest.fn(async () => false),
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

describe("relay target validation: slack-bridge is a special target", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastRelayDoc = {};
  });

  // onSlackBridge (functions) posts every relay doc with target "slack-bridge" to #grid-ops.
  // No program is registered under that name, so the false-success guard refused it and
  // no REST or MCP caller could reach the bridge (recognizer-vm, PDR #1496 R4, 2026-10-29).
  it("accepts target slack-bridge although no program is registered under it", async () => {
    const result = await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "slack-bridge",
      message_type: "STATUS",
      message: "ORCHESTRATOR STUCK: test",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(lastRelayDoc.target).toBe("slack-bridge");
  });

  it("still refuses an unregistered program name", async () => {
    const result = await sendMessageHandler(flynnAuth(), {
      source: "flynn",
      target: "no-such-program",
      message_type: "STATUS",
      message: "x",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unknown relay target");
  });
});
