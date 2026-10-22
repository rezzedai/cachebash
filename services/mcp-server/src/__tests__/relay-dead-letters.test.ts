/**
 * K0NF26vX: relay messages that expire unread must stay in tenants/{uid}/relay
 * (marked dead_lettered in place) so sent / inbox / dead-letter reads see them,
 * and get_dead_letters also lists the legacy tenants/{uid}/dead_letters copies
 * the old processDeadLetters left behind after deleting the originals.
 */
import type { AuthContext } from "../auth/authValidator";
import { getMessagesHandler, getSentMessagesHandler, getDeadLettersHandler } from "../modules/relay";
import { isAdmin } from "../middleware/gate";

type Doc = Record<string, any>;
const ts = (iso: string) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });
const val = (v: any) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);

let STORE: Record<string, Doc> = {};

class Q {
  constructor(private rows: Array<[string, Doc]>, private lim: number | null = null) {}
  where(field: string, op: string, value: any) {
    return new Q(this.rows.filter(([, d]) => {
      if (op === "==") return d[field] === value;
      if (op === "in") return (value as any[]).includes(d[field]);
      throw new Error(`unsupported ${op}`);
    }), this.lim);
  }
  orderBy(field: string, dir: string = "asc") {
    return new Q([...this.rows].sort((a, b) => (val(a[1][field]) - val(b[1][field])) * (dir === "desc" ? -1 : 1)), this.lim);
  }
  limit(n: number) { return new Q(this.rows, n); }
  async get() {
    const page = this.lim == null ? this.rows : this.rows.slice(0, this.lim);
    return { empty: page.length === 0, size: page.length,
      docs: page.map(([path, d]) => ({ id: path.split("/").pop()!, ref: { path }, data: () => d })) };
  }
}

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({
    collection: (path: string) =>
      new Q(Object.entries(STORE).filter(([p]) => p.split("/").slice(0, -1).join("/") === path)),
  })),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));
jest.mock("../middleware/gate.js", () => {
  const real = jest.requireActual("../middleware/gate.js");
  return { ...real, isAdmin: jest.fn(() => false), logAudit: jest.fn(), generateCorrelationId: jest.fn(() => "corr-1") };
});
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../config/compliance.js", () => ({
  getComplianceConfig: jest.fn(() => ({ idempotencyKey: { enforcement: "none" }, ackAudit: { enabled: false } })),
}));
jest.mock("../modules/ack-compliance.js", () => ({ logDirective: jest.fn(), markDirectiveAcknowledged: jest.fn() }));

const auth = (programId: string): AuthContext => ({
  userId: "u1", apiKeyHash: "h", encryptionKey: Buffer.from("abc"), programId: programId as any,
  keyProgramId: programId as any, capabilities: ["relay:read"], rateLimitTier: "standard",
} as any);

const pending61m: Doc = {
  source: "vector", target: "tensor", message_type: "DIRECTIVE", status: "pending", payload: "p61",
  priority: "normal", action: "queue", deliveryAttempts: 0, maxDeliveryAttempts: 3,
  createdAt: ts("2026-10-21T02:40:49.000Z"), expiresAt: ts("2026-10-22T02:40:49.000Z"),
};

beforeEach(() => { jest.clearAllMocks(); STORE = {}; });

describe("a pending message to a slow reader stays readable", () => {
  it("get_sent_messages(vector) and get_messages(tensor) both return a 61-minute-old pending doc", async () => {
    STORE["tenants/u1/relay/m1"] = pending61m;
    const sent = JSON.parse((await getSentMessagesHandler(auth("vector"), {})).content[0].text);
    expect(sent.messages.map((m: any) => m.id)).toEqual(["m1"]);
    const inbox = JSON.parse((await getMessagesHandler(auth("tensor"), { sessionId: "tensor-s1", markAsRead: false })).content[0].text);
    expect(inbox.interrupts.map((m: any) => m.id)).toEqual(["m1"]);
  });
});

describe("get_dead_letters", () => {
  beforeEach(() => (isAdmin as jest.Mock).mockReturnValue(true));

  it("returns a message dead-lettered in place, and get_sent_messages still shows it", async () => {
    STORE["tenants/u1/relay/m1"] = {
      ...pending61m, status: "dead_lettered", dead_letter_reason: "EXPIRED_TTL", dead_letter_class: "EXPIRED_TTL",
      deadLetteredAt: ts("2026-10-22T02:55:00.000Z"),
    };
    const dl = JSON.parse((await getDeadLettersHandler(auth("flynn"), {})).content[0].text);
    expect(dl.deadLetters.map((d: any) => [d.id, d.legacy])).toEqual([["m1", false]]);
    const sent = JSON.parse((await getSentMessagesHandler(auth("vector"), {})).content[0].text);
    expect(sent.messages.map((m: any) => [m.id, m.status])).toEqual([["m1", "dead_lettered"]]);
  });

  it("also lists the legacy tenants/{uid}/dead_letters copies, flagged legacy, newest first", async () => {
    STORE["tenants/u1/relay/m2"] = { ...pending61m, status: "dead_lettered", deadLetteredAt: ts("2026-10-22T02:55:00.000Z") };
    STORE["tenants/u1/dead_letters/ADMbKpD6AfANSdhYE9w2"] = {
      ...pending61m, status: "dead_letter", deliveryAttempts: 3,
      createdAt: ts("2026-10-21T02:40:49.000Z"), deadLetteredAt: ts("2026-10-21T04:21:09.000Z"),
      originalPath: "tenants/u1/relay/ADMbKpD6AfANSdhYE9w2",
    };
    const dl = JSON.parse((await getDeadLettersHandler(auth("flynn"), {})).content[0].text);
    expect(dl.deadLetters.map((d: any) => [d.id, d.legacy])).toEqual([["m2", false], ["ADMbKpD6AfANSdhYE9w2", true]]);
    expect(dl.deadLetters[1].dead_letter_reason).toBe("UNREAD_AFTER_1H_LEGACY");
    expect(dl.deadLetters[1].deliveryAttempts).toBe(3);
  });

  it("honours the limit across both sources", async () => {
    for (let i = 0; i < 3; i++) {
      STORE[`tenants/u1/dead_letters/l${i}`] = { ...pending61m, status: "dead_letter", deadLetteredAt: ts(`2026-10-21T0${i}:00:00.000Z`) };
    }
    const dl = JSON.parse((await getDeadLettersHandler(auth("flynn"), { limit: 2 })).content[0].text);
    expect(dl.deadLetters.map((d: any) => d.id)).toEqual(["l2", "l1"]);
  });

  it("is still admin only", async () => {
    (isAdmin as jest.Mock).mockReturnValue(false);
    const r = JSON.parse((await getDeadLettersHandler(auth("tensor"), {})).content[0].text);
    expect(r.success).toBe(false);
  });
});
