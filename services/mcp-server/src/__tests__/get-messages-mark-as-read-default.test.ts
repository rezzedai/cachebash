/**
 * Regression test: get_messages must drain by default (R2.4).
 *
 * Defect (plan grid/plans/ISO-plan-dispatch-defects-1-and-2.md §7): `markAsRead`
 * defaulted to false, so CLAUDE.md's documented bare boot call --
 * get_messages(sessionId: "{program}") -- and the wake nudge never drained
 * anything. Messages stayed "pending" forever and re-served identically on
 * every poll.
 *
 * FIX: flip the default to true. The one real risk this opens: a caller
 * with broad visibility (legacy/mobile/dispatcher-tier keys) reading ANOTHER
 * program's inbox would now silently claim it by default. Enumeration
 * (recorded in the PR) found exactly one such call site
 * (`GET /v1/interrupts/peek`), already hardcoded to markAsRead:false.
 *
 * SEPARATELY, this surfaced a real, confirmed bug: `dispatch()` writes a
 * broadcast (target:"all") as a SINGLE relay doc with no per-recipient
 * delivery state. Under the old default this was latent (nothing drained by
 * default); flipping the default would make the FIRST reader silently
 * swallow the broadcast for every other program it targeted, since the next
 * reader's default query only sees status:"pending". Broadcasts are
 * therefore exempted from the claim mutation entirely.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((source: string) => source),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "corr-1"),
}));
jest.mock("../modules/ack-compliance.js", () => ({ logDirective: jest.fn(), markDirectiveAcknowledged: jest.fn() }));
jest.mock("../config/compliance.js", () => ({
  getComplianceConfig: jest.fn(() => ({ idempotencyKey: { enforcement: "off" }, ackAudit: { enabled: false } })),
}));

type FakeData = Record<string, unknown>;
let messages: Record<string, FakeData> = {};

function makeMsg(id: string, overrides: FakeData = {}): void {
  messages[id] = {
    source: "iso",
    target: "basher",
    payload: `body-${id}`,
    message_type: "DIRECTIVE",
    status: "pending",
    priority: "normal",
    action: "queue",
    createdAt: { toDate: () => new Date(2026, 0, 1) },
    deliveryAttempts: 0,
    ...overrides,
  };
}

function toQueryDoc(id: string) {
  return { id, ref: { id }, data: () => messages[id] };
}

function buildQuery() {
  const wheres: Array<[string, string, unknown]> = [];
  const query: any = {
    where: jest.fn((field: string, op: string, value: unknown) => {
      wheres.push([field, op, value]);
      return query;
    }),
    orderBy: jest.fn(() => query),
    get: jest.fn(async () => {
      const ids = Object.keys(messages).filter((id) => {
        const data = messages[id];
        return wheres.every(([field, op, value]) => {
          const actual = data[field];
          if (op === "==") return actual === value;
          if (op === "in") return Array.isArray(value) && (value as unknown[]).includes(actual);
          return true;
        });
      });
      return { docs: ids.map(toQueryDoc) };
    }),
  };
  return query;
}

const mockDb = {
  collection: jest.fn(() => buildQuery()),
  runTransaction: jest.fn(async (fn: any) => {
    const tx = {
      get: jest.fn(async (ref: { id: string }) => ({
        exists: !!messages[ref.id],
        data: () => messages[ref.id],
      })),
      update: jest.fn((ref: { id: string }, patch: FakeData) => {
        const current = messages[ref.id];
        const next: FakeData = { ...current };
        for (const [k, v] of Object.entries(patch)) {
          next[k] = k === "deliveryAttempts" ? ((current.deliveryAttempts as number) || 0) + 1 : v;
        }
        messages[ref.id] = next;
      }),
    };
    return fn(tx);
  }),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

import { getMessagesHandler } from "../modules/relay.js";
import type { AuthContext } from "../auth/authValidator.js";

function makeAuth(programId: string): AuthContext {
  return {
    userId: "u1",
    programId,
    apiKeyHash: "hash",
    encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
    capabilities: ["*"],
    rateLimitTier: "internal",
  } as AuthContext;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  jest.clearAllMocks();
  messages = {};
});

describe("get_messages mark-as-read default — R2.4", () => {
  it("a bare call (no markAsRead) now drains a direct pending message", async () => {
    makeMsg("m1", { target: "basher" });

    const res = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher" }));

    expect(res.interrupts.map((m: any) => m.id)).toEqual(["m1"]);
    expect(res.interrupts[0].status).toBe("delivered");
    expect(messages.m1.status).toBe("delivered");
    expect(messages.m1.deliveryAttempts).toBe(1);
  });

  it("an explicit markAsRead:false still does NOT drain — the observer path remains available", async () => {
    makeMsg("m1", { target: "basher" });

    const res = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher", markAsRead: false }));

    expect(res.interrupts.map((m: any) => m.id)).toEqual(["m1"]);
    expect(res.interrupts[0].status).toBe("pending");
    expect(messages.m1.status).toBe("pending");
    expect(messages.m1.deliveryAttempts).toBe(0);
  });

  it("includeDelivered:true still returns the body after a drain (ADR-013 unbroken)", async () => {
    makeMsg("m1", { target: "basher" });

    const first = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher" }));
    expect(first.interrupts.map((m: any) => m.id)).toEqual(["m1"]);
    expect(messages.m1.status).toBe("delivered");

    const second = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher" }));
    expect(second.interrupts).toEqual([]);

    const reread = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher", includeDelivered: true }));
    expect(reread.interrupts.map((m: any) => m.id)).toEqual(["m1"]);
    expect(reread.interrupts[0].message).toBe("body-m1");
    // Re-read must never re-claim.
    expect(messages.m1.deliveryAttempts).toBe(1);
  });

  it("R2.4 broadcast exemption: target:'all' is never marked delivered, even with markAsRead:true, and deliveryAttempts never increments", async () => {
    makeMsg("bcast", { target: "all", message_type: "STATUS" });

    const res = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher", markAsRead: true }));

    expect(res.interrupts.map((m: any) => m.id)).toEqual(["bcast"]);
    expect(res.interrupts[0].status).toBe("pending");
    expect(messages.bcast.status).toBe("pending");
    expect(messages.bcast.deliveryAttempts).toBe(0);
  });

  it("R2.4 broadcast exemption: a broadcast survives being claimed by one recipient -- a different recipient still sees it as pending", async () => {
    makeMsg("bcast", { target: "all", message_type: "STATUS" });

    const first = parse(await getMessagesHandler(makeAuth("scalar"), { sessionId: "scalar" })); // bare, drains by default
    expect(first.interrupts.map((m: any) => m.id)).toEqual(["bcast"]);
    expect(messages.bcast.status).toBe("pending"); // unmutated

    const second = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher" })); // different program, also bare
    expect(second.interrupts.map((m: any) => m.id)).toEqual(["bcast"]);
    expect(second.interrupts[0].status).toBe("pending");
  });

  it("a direct message and a broadcast in the same call: the direct message drains, the broadcast does not", async () => {
    makeMsg("direct", { target: "basher" });
    makeMsg("bcast", { target: "all", message_type: "STATUS" });

    const res = parse(await getMessagesHandler(makeAuth("basher"), { sessionId: "basher" }));

    const direct = res.interrupts.find((m: any) => m.id === "direct");
    const bcast = res.interrupts.find((m: any) => m.id === "bcast");
    expect(direct.status).toBe("delivered");
    expect(bcast.status).toBe("pending");
    expect(messages.direct.deliveryAttempts).toBe(1);
    expect(messages.bcast.deliveryAttempts).toBe(0);
  });
});
