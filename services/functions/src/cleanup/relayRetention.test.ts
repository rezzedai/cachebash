/**
 * K0NF26vX (2026-10-21): processDeadLetters deleted unread relay messages ~1.5h
 * after sending (copy to tenants/{uid}/dead_letters + batch.delete), so a slow
 * reader's mail vanished for sender and recipient. These tests run the three
 * relay reapers against one in-memory Firestore that keeps the relay collection
 * as the single source of truth for the sent/inbox/dead-letter reads.
 */
import { deadLetterExpiredRelay } from "./processDeadLetters";
import { cleanupRelayByRetention, DEAD_LETTER_RETENTION_MS } from "./cleanupExpiredRelay";
import { reapTasks, reapProposals } from "./reapExpiredByTTL";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 21, 2, 40, 0);

type Doc = Record<string, any>;

function makeStore(initial: Record<string, Doc>) {
  const store = new Map<string, Doc>(Object.entries(initial));
  const val = (v: any) => (v instanceof Date ? v.getTime() : v);

  class Q {
    constructor(private rows: Array<[string, Doc]>, private lim: number | null = null) {}
    where(field: string, op: string, value: any) {
      const v = val(value);
      const rows = this.rows.filter(([, d]) => {
        const f = val(d[field]);
        if (op === "==") return f === v;
        if (op === "<") return f != null && f < v;
        throw new Error(`unsupported ${op}`);
      });
      return new Q(rows, this.lim);
    }
    orderBy(field: string, dir: string = "asc") {
      const rows = [...this.rows].sort((a, b) => (val(a[1][field]) - val(b[1][field])) * (dir === "desc" ? -1 : 1));
      return new Q(rows, this.lim);
    }
    limit(n: number) { return new Q(this.rows, n); }
    async get() {
      const page = this.lim == null ? this.rows : this.rows.slice(0, this.lim);
      return {
        empty: page.length === 0,
        size: page.length,
        docs: page.map(([path, d]) => ({
          id: path.split("/").pop(),
          ref: { path, id: path.split("/").pop() },
          get: (f: string) => d[f],
          data: () => ({ ...d }),
        })),
      };
    }
  }

  const db: any = {
    collectionGroup: (name: string) =>
      new Q([...store.entries()].filter(([p]) => p.split("/").slice(-2, -1)[0] === name)),
    collection: (path: string) =>
      new Q([...store.entries()].filter(([p]) => p.split("/").slice(0, -1).join("/") === path)),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: Doc) => ops.push(() => store.set(ref.path, data)),
        update: (ref: any, data: Doc) => ops.push(() => store.set(ref.path, { ...store.get(ref.path), ...data })),
        delete: (ref: any) => ops.push(() => store.delete(ref.path)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
  };
  return { store, db };
}

function relayDoc(over: Doc = {}): Doc {
  return {
    source: "vector", target: "tensor", message_type: "DIRECTIVE", status: "pending",
    payload: "p", deliveryAttempts: 0, maxDeliveryAttempts: 3,
    createdAt: new Date(T0), expiresAt: new Date(T0 + DAY), ...over,
  };
}

const PATH = "tenants/u1/relay/m1";
// What get_sent_messages(vector) and get_messages(tensor) read: the tenant's relay collection.
const sentBy = (db: any, source: string) => db.collection("tenants/u1/relay").where("source", "==", source).orderBy("createdAt", "desc").limit(50).get();
const inboxOf = (db: any, target: string) => db.collection("tenants/u1/relay").where("target", "==", target).where("status", "==", "pending").limit(50).get();
const deadLetters = (db: any) => db.collection("tenants/u1/relay").where("status", "==", "dead_lettered").orderBy("deadLetteredAt", "desc").limit(50).get();

describe("a pending relay message is deliverable until its expiresAt", () => {
  it("61 minutes old with 0 attempts survives three processDeadLetters runs and stays readable", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc() });
    const now = new Date(T0 + 61 * MIN);
    for (let run = 0; run < 3; run++) {
      const r = await deadLetterExpiredRelay(db, new Date(now.getTime() + run * 15 * MIN));
      expect(r.deadLettered).toBe(0);
    }
    expect(store.has(PATH)).toBe(true);
    expect(store.get(PATH)!.status).toBe("pending");
    expect(store.get(PATH)!.deliveryAttempts).toBe(0);
    expect([...store.keys()].some((p) => p.includes("/dead_letters/"))).toBe(false);
    expect((await sentBy(db, "vector")).size).toBe(1);
    expect((await inboxOf(db, "tensor")).size).toBe(1);
  });

  it("the production shape: still unread at 1h40m, still there", async () => {
    // ADMbKpD6AfANSdhYE9w2 was dead-lettered 1:40:20 after createdAt with deliveryAttempts 3
    const { store, db } = makeStore({ [PATH]: relayDoc({ deliveryAttempts: 2 }) });
    await deadLetterExpiredRelay(db, new Date(T0 + 100 * MIN));
    await cleanupRelayByRetention(db, new Date(T0 + 100 * MIN));
    expect(store.get(PATH)!.status).toBe("pending");
  });

  it("past expiresAt it is marked dead_lettered in place, not deleted or copied, and get_dead_letters sees it", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc() });
    const r = await deadLetterExpiredRelay(db, new Date(T0 + DAY + MIN));
    expect(r.deadLettered).toBe(1);
    const doc = store.get(PATH)!;
    expect(doc.status).toBe("dead_lettered");
    expect(doc.deadLetteredAt).toBeDefined();
    expect(doc.dead_letter_reason).toBe("EXPIRED_TTL");
    expect(doc.reason).toBe("TTL expired");
    expect([...store.keys()].some((p) => p.includes("/dead_letters/"))).toBe(false);
    expect((await deadLetters(db)).docs.map((d: any) => d.id)).toEqual(["m1"]);
    expect((await sentBy(db, "vector")).size).toBe(1);        // still in sent / history
    expect((await inboxOf(db, "tensor")).size).toBe(0);       // no longer deliverable
  });

  it("a pending doc with no expiresAt is dead-lettered only after the default 24h TTL", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ expiresAt: undefined }) });
    expect((await deadLetterExpiredRelay(db, new Date(T0 + 23 * HOUR))).deadLettered).toBe(0);
    expect((await deadLetterExpiredRelay(db, new Date(T0 + 25 * HOUR))).deadLettered).toBe(1);
    expect(store.get(PATH)!.status).toBe("dead_lettered");
  });

  it("an old pending doc whose expiresAt is still in the future is not dead-lettered by age", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ expiresAt: new Date(T0 + 10 * DAY) }) });
    expect((await deadLetterExpiredRelay(db, new Date(T0 + 3 * DAY))).deadLettered).toBe(0);
    expect(store.get(PATH)!.status).toBe("pending");
  });

  it("delivered docs are left alone", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ status: "delivered" }) });
    await deadLetterExpiredRelay(db, new Date(T0 + 5 * DAY));
    expect(store.get(PATH)!.status).toBe("delivered");
  });
});

describe("cleanupExpiredRelay keeps what processDeadLetters has not yet marked", () => {
  it("never deletes a pending doc, even past its expiresAt", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc() });
    const r = await cleanupRelayByRetention(db, new Date(T0 + 3 * DAY));
    expect(r.deleted).toBe(0);
    expect(store.get(PATH)!.status).toBe("pending");
  });

  it("does not delete a dead_lettered doc younger than 7 days", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ status: "dead_lettered", deadLetteredAt: new Date(T0 + DAY) }) });
    const expiresAt = T0 + DAY;
    const r = await cleanupRelayByRetention(db, new Date(expiresAt + DEAD_LETTER_RETENTION_MS - MIN));
    expect(r.deleted).toBe(0);
    expect(store.has(PATH)).toBe(true);
  });

  it("deletes a dead_lettered doc 7 days after its expiresAt", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ status: "dead_lettered" }) });
    const r = await cleanupRelayByRetention(db, new Date(T0 + DAY + DEAD_LETTER_RETENTION_MS + MIN));
    expect(r.deleted).toBe(1);
    expect(store.has(PATH)).toBe(false);
  });

  it("deletes a dead_lettered doc with no expiresAt only after createdAt + 24h + 7 days", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ status: "dead_lettered", expiresAt: undefined }) });
    expect((await cleanupRelayByRetention(db, new Date(T0 + 7 * DAY))).deleted).toBe(0);
    expect((await cleanupRelayByRetention(db, new Date(T0 + 8 * DAY + MIN))).deleted).toBe(1);
    expect(store.has(PATH)).toBe(false);
  });

  it("still retires delivered docs after 48h", async () => {
    const { store, db } = makeStore({ [PATH]: relayDoc({ status: "delivered" }) });
    expect((await cleanupRelayByRetention(db, new Date(T0 + 47 * HOUR))).deleted).toBe(0);
    expect((await cleanupRelayByRetention(db, new Date(T0 + 49 * HOUR))).deleted).toBe(1);
    expect(store.has(PATH)).toBe(false);
  });
});

describe("the three reapers, run in either order on the expiresAt boundary", () => {
  it("end with the doc dead_lettered, never expired and never deleted", async () => {
    for (const order of ["dl-first", "dl-last"]) {
      const { store, db } = makeStore({ [PATH]: relayDoc() });
      const now = new Date(T0 + DAY + MIN);
      const ts = { toMillis: () => now.getTime() } as any;
      const reapers = [
        () => cleanupRelayByRetention(db, now),
        () => reapTasks(db, ts),
        () => reapProposals(db, ts),
      ];
      if (order === "dl-first") await deadLetterExpiredRelay(db, now);
      for (const f of reapers) await f();
      if (order === "dl-last") await deadLetterExpiredRelay(db, now);
      expect(store.get(PATH)!.status).toBe("dead_lettered");
    }
  });
});
