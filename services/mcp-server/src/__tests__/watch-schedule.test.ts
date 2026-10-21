/**
 * PRE-OPEN watchdog: schedules of kind "watch" create no task. When one fires it
 * looks at the tasks another schedule made recently and writes ONE alert (relay
 * doc + mirrored task, the shape send_alert writes) if they are all still
 * unclaimed, or if there are none. Kind-less schedules are unchanged.
 */

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));

import * as admin from "firebase-admin";
import { executeSchedulesForUser } from "../modules/schedule-executor.js";
import { createScheduleHandler } from "../modules/schedule.js";
import { sendAlertHandler } from "../modules/signal.js";

// ── Minimal in-memory Firestore ─────────────────────────────────────────────
type Row = Record<string, any>;
const store = new Map<string, Map<string, Row>>();
let idSeq = 0;
// Firestore transactions are serializable; a queue gives the same outcome for
// concurrent fires (the loser re-reads the winner's advanced nextRunAt).
let txnQueue: Promise<unknown> = Promise.resolve();

const col = (path: string) => {
  if (!store.has(path)) store.set(path, new Map());
  return store.get(path)!;
};
const ref = (path: string, id: string) => ({ id, path, parent: path });
const snap = (path: string, id: string) => {
  const data = col(path).get(id);
  return { id, exists: data !== undefined, ref: ref(path, id), data: () => data && { ...data } };
};
const query = (path: string, filters: Array<[string, string, any]> = []) => ({
  where: (f: string, op: string, v: any) => query(path, [...filters, [f, op, v]]),
  get: async () => ({
    docs: [...col(path).keys()]
      .filter((id) => filters.every(([f, op, v]) => {
        const x = col(path).get(id)![f];
        return op === "==" ? (x ?? null) === v : x !== undefined && x !== null && x <= v;
      }))
      .map((id) => snap(path, id)),
  }),
});
const mockDb: any = {
  collection: (path: string) => ({
    ...query(path),
    doc: (id?: string) => ref(path, id ?? `auto-${++idSeq}`),
    add: async (data: Row) => {
      const id = `auto-${++idSeq}`;
      col(path).set(id, data);
      return ref(path, id);
    },
  }),
  runTransaction: (fn: any) => {
    const run = txnQueue.then(() =>
      fn({
        get: async (target: any) => (target.get ? target.get() : snap(target.path, target.id)),
        create: (r: any, data: Row) => {
          if (col(r.path).has(r.id)) throw new Error("ALREADY_EXISTS");
          col(r.path).set(r.id, data);
        },
        update: (r: any, data: Row) => col(r.path).set(r.id, { ...col(r.path).get(r.id), ...data }),
      }),
    );
    txnQueue = run.catch(() => undefined);
    return run;
  },
};
// set() on a doc ref (send_alert's task mirror) -- attach via the ref factory.
const origRef = mockDb.collection;
mockDb.collection = (path: string) => {
  const c = origRef(path);
  const doc = c.doc;
  c.doc = (id?: string) => {
    const r: any = doc(id);
    r.set = async (data: Row) => { col(path).set(r.id, data); };
    return r;
  };
  return c;
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => admin.firestore.Timestamp.fromMillis(Date.now())),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const U = "u1";
const SCHED = `tenants/${U}/schedules`;
const TASKS = `tenants/${U}/tasks`;
const RELAY = `tenants/${U}/relay`;
const WATCHED = "watched-sched";
const MSG = "PRE-OPEN READINESS is still unclaimed at 13:15Z.";
const ago = (h: number) => admin.firestore.Timestamp.fromMillis(Date.now() - h * 3600 * 1000);

function seedWatch() {
  col(SCHED).set("w1", {
    name: "PRE-OPEN watchdog", target: "iso", cron: "15 13 * * 1-5", enabled: true,
    nextRunAt: new Date(Date.now() - 1000).toISOString(), kind: "watch",
    watch: { scheduleId: WATCHED, status: "created", withinHours: 2, message: MSG },
  });
}
const seedWatched = (id: string, status: string, hoursAgo: number) =>
  col(TASKS).set(id, { scheduleId: WATCHED, status, createdAt: ago(hoursAgo) });
const schedulerTasks = () => [...col(TASKS).values()].filter((t) => t.source === "scheduler");

beforeEach(() => { store.clear(); idSeq = 0; txnQueue = Promise.resolve(); });

describe("watch schedule firing", () => {
  it("(a) watched task still created: exactly 1 alert (relay + mirror), no task", async () => {
    seedWatch(); seedWatched("t1", "created", 0.5);
    const r = await executeSchedulesForUser(U);

    expect(r.errors).toBe(0);
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0].taskId).toBeNull();
    expect(schedulerTasks()).toHaveLength(0);

    const relays = [...col(RELAY).entries()];
    expect(relays).toHaveLength(1);
    const [relayId, relay] = relays[0];
    expect(relay).toMatchObject({
      source: "watchdog", target: "slack-bridge", message_type: "STATUS", priority: "high",
      alertType: "error", payload: MSG, status: "pending", ttl: 3600,
    });
    expect(relay.expiresAt).toBeDefined();
    const mirror = col(TASKS).get(relayId)!;
    expect(mirror).toMatchObject({
      type: "task", target: "user", source: "watchdog", priority: "high", status: "created",
      instructions: MSG, requires_action: false, ttl: 3600,
    });
    expect(mirror.title).toBe(`[Alert: error] ${MSG}`); // 50 chars: not truncated
    expect(col(TASKS).size).toBe(2); // the watched task + the mirror; nothing else
    expect(col(SCHED).get("w1")!.nextRunAt > new Date().toISOString()).toBe(true);
  });

  it("(b) watched task claimed: no alert, schedule still advances", async () => {
    seedWatch(); seedWatched("t1", "active", 0.5);
    const r = await executeSchedulesForUser(U);

    expect(r.fired).toHaveLength(1);
    expect(r.fired[0].alertId).toBeUndefined();
    expect(col(RELAY).size).toBe(0);
    expect(col(TASKS).size).toBe(1);
    expect(col(SCHED).get("w1")!.lastRunAt).toBeDefined();
  });

  it("(b2) any one watched task past the watched status: no alert", async () => {
    seedWatch(); seedWatched("t1", "created", 0.5); seedWatched("t2", "done", 0.4);
    await executeSchedulesForUser(U);
    expect(col(RELAY).size).toBe(0);
  });

  it("(c) no watched task in the window: 1 alert with the did-not-fire text", async () => {
    seedWatch();
    seedWatched("old", "created", 5); // outside the 2h window: must not count
    await executeSchedulesForUser(U);

    const relays = [...col(RELAY).values()];
    expect(relays).toHaveLength(1);
    expect(relays[0].payload).toContain("did not fire");
    expect(relays[0].payload).toContain(WATCHED);
    expect(relays[0].payload).toContain(MSG);
    expect(relays[0]).toMatchObject({ source: "watchdog", target: "slack-bridge", priority: "high", alertType: "error" });
  });

  it("(e) concurrent double fire still produces 1 alert", async () => {
    seedWatch(); seedWatched("t1", "created", 0.5);
    await Promise.all([executeSchedulesForUser(U), executeSchedulesForUser(U)]);
    expect(col(RELAY).size).toBe(1);
  });

  it("a malformed watch config errors loudly instead of passing quietly", async () => {
    seedWatch(); col(SCHED).get("w1")!.watch = { scheduleId: WATCHED };
    const r = await executeSchedulesForUser(U);
    expect(r.errors).toBe(1);
    expect(r.fired).toHaveLength(0);
    expect(col(SCHED).get("w1")!.lastRunAt).toBeUndefined();
  });
});

describe("kind-less schedule", () => {
  it("(d) still creates its task, unchanged, and writes no alert", async () => {
    col(SCHED).set("s1", {
      name: "nightly", target: "iso", cron: "0 0 * * *", enabled: true, nextRunAt: null,
      taskTemplate: { title: "Nightly job", priority: "high" },
    });
    const r = await executeSchedulesForUser(U);

    expect(r.fired).toHaveLength(1);
    expect(typeof r.fired[0].taskId).toBe("string");
    expect(schedulerTasks()).toHaveLength(1);
    expect(schedulerTasks()[0]).toMatchObject({
      title: "Nightly job", target: "iso", priority: "high", status: "created", scheduleId: "s1",
    });
    expect(col(RELAY).size).toBe(0);
  });
});

describe("schedule_create validation", () => {
  const auth: any = { userId: U, programId: "iso" };
  const base = { name: "PRE-OPEN watchdog", target: "iso", cron: "15 13 * * 1-5" };
  const watch = { scheduleId: WATCHED, status: "created", withinHours: 2, message: MSG };

  it("creates a watch schedule: kind + watch stored, no taskTemplate, nextRunAt is 13:15Z UTC", async () => {
    const out = JSON.parse((await createScheduleHandler(auth, { ...base, kind: "watch", watch })).content[0].text);
    expect(out.success).toBe(true);
    const doc = col(SCHED).get(out.scheduleId)!;
    expect(doc.kind).toBe("watch");
    expect(doc.watch).toEqual(watch);
    expect(doc.taskTemplate).toBeUndefined();
    expect(doc.nextRunAt).toMatch(/T13:15:00\.000Z$/);
  });

  it("rejects a watch without a watch config, and a task schedule without a template", async () => {
    await expect(createScheduleHandler(auth, { ...base, kind: "watch" })).rejects.toThrow();
    await expect(createScheduleHandler(auth, { ...base })).rejects.toThrow();
    await expect(createScheduleHandler(auth, { ...base, kind: "watch", watch, taskTemplate: { title: "x" } })).rejects.toThrow();
  });

  it("a plain task schedule is stored as before, with kind task", async () => {
    const out = JSON.parse((await createScheduleHandler(auth, { ...base, taskTemplate: { title: "x" } })).content[0].text);
    const doc = col(SCHED).get(out.scheduleId)!;
    expect(doc.kind).toBe("task");
    expect(doc.taskTemplate.title).toBe("x");
    expect(doc.watch).toBeUndefined();
  });
});

describe("send_alert keeps its shape after the helper extraction", () => {
  it("writes source program, target user, and the task mirror under the relay id", async () => {
    const out = JSON.parse((await sendAlertHandler({ userId: U } as any, { message: "hi", alertType: "warning", priority: "high" })).content[0].text);
    const relay = col(RELAY).get(out.alertId)!;
    expect(relay).toMatchObject({ source: "program", target: "user", payload: "hi", alertType: "warning", priority: "high" });
    expect(col(TASKS).get(out.alertId)).toMatchObject({ title: "[Alert: warning] hi", source: "program", target: "user" });
  });
});
