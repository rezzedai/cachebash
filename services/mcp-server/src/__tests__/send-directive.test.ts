import type { AuthContext } from "../auth/authValidator";
import { sendDirectiveHandler, sendMessageHandler } from "../modules/relay";

let lastRelayDoc: Record<string, unknown> = {};

const mockDocRef = {
  id: "relay-doc-id",
  set: jest.fn(async () => {}),
  get: jest.fn(async () => ({ exists: false })),
};

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => mockDocRef),
    add: jest.fn(async (data: Record<string, unknown>) => {
      lastRelayDoc = data;
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
  verifySource: jest.fn((source: string) => source),
  isAdmin: jest.fn(() => false),
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

jest.mock("./../../src/modules/programRegistry.js", () => ({
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

function auth(): AuthContext {
  return {
    userId: "u1",
    apiKeyHash: "k1",
    encryptionKey: Buffer.from("abc"),
    programId: "vector" as any,
    keyProgramId: "vector" as any,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
}

describe("send_directive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastRelayDoc = {};
  });

  it("succeeds with 3 required params", async () => {
    const result = await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Deploy the fix",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe("relay-doc-id");
  });

  it("sets message_type to DIRECTIVE in the relay doc", async () => {
    await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Run tests",
    });

    expect(lastRelayDoc.message_type).toBe("DIRECTIVE");
  });

  it("sets action to interrupt in the relay doc", async () => {
    await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Run tests",
    });

    expect(lastRelayDoc.action).toBe("interrupt");
  });

  it("defaults priority to high when not specified", async () => {
    await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Fix the bug",
    });

    expect(lastRelayDoc.priority).toBe("high");
  });

  it("allows overriding priority", async () => {
    await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Low priority task",
      priority: "low",
    });

    expect(lastRelayDoc.priority).toBe("low");
  });

  it("passes threadId through to relay doc", async () => {
    await sendDirectiveHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Continue sprint",
      threadId: "thread-abc",
    });

    expect(lastRelayDoc.threadId).toBe("thread-abc");
  });

  it("throws validation error when source is missing", async () => {
    await expect(
      sendDirectiveHandler(auth(), {
        target: "basher",
        message: "No source",
      })
    ).rejects.toThrow();
  });

  it("throws validation error when target is missing", async () => {
    await expect(
      sendDirectiveHandler(auth(), {
        source: "vector",
        message: "No target",
      })
    ).rejects.toThrow();
  });

  it("throws validation error when message is missing", async () => {
    await expect(
      sendDirectiveHandler(auth(), {
        source: "vector",
        target: "basher",
      })
    ).rejects.toThrow();
  });
});

describe("send_message ttl (W2d.2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastRelayDoc = {};
  });

  it("rejects ttl:0 with a clear, deliberate error -- not a silent substitution of the default", async () => {
    await expect(
      sendMessageHandler(auth(), {
        source: "vector",
        target: "basher",
        message: "Never-expires attempt",
        message_type: "PING",
        ttl: 0,
      })
    ).rejects.toThrow(/never-expires/i);
  });

  it("still rejects a negative ttl", async () => {
    await expect(
      sendMessageHandler(auth(), {
        source: "vector",
        target: "basher",
        message: "Invalid ttl",
        message_type: "PING",
        ttl: -5,
      })
    ).rejects.toThrow();
  });

  it("honours an explicit positive ttl", async () => {
    await sendMessageHandler(auth(), {
      source: "vector",
      target: "basher",
      message: "Custom ttl",
      message_type: "PING",
      ttl: 300,
    });

    expect(lastRelayDoc.ttl).toBe(300);
    const expiresAtMs = (lastRelayDoc.expiresAt as { toMillis: () => number }).toMillis();
    const now = Date.now();
    expect(expiresAtMs).toBeGreaterThanOrEqual(now + 299_000);
    expect(expiresAtMs).toBeLessThanOrEqual(now + 301_000);
  });
});
