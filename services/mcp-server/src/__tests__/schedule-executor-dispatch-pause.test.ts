/**
 * RD-5 PR-G: the schedule executor skips task schedules while the tenant's dispatchPaused flag is
 * set, with no write (nextRunAt unchanged), still fires watch schedules, fails closed when the flag
 * cannot be read, and fires the schedule once the flag clears.
 */
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/signal.js", () => ({ writeAlertDocs: jest.fn(async () => "alert-1"), sendAlertHandler: jest.fn() }));
const readDispatchPause = jest.fn<Promise<"paused" | "clear" | "unknown">, [string]>();
jest.mock("../middleware/circuitBreaker.js", () => ({ readDispatchPause: (o: string) => readDispatchPause(o) }));

const schedules = new Map<string, any>();
const tasks: any[] = [];
const writes: any[] = [];

const mockDb: any = {
  collection: jest.fn((path: string) => ({
    where: jest.fn().mockReturnThis(),
    get: jest.fn(async () => {
      const due = path.endsWith("/schedules") && !(mockDb as any)._second;
      (mockDb as any)._second = !(mockDb as any)._second;
      return { docs: due ? [...schedules.entries()].map(([id, d]) => ({ id, ref: { id }, data: () => d })) : [] };
    }),
    doc: jest.fn(() => ({ id: `task-${tasks.length + 1}` })),
  })),
  runTransaction: jest.fn((fn: any) => fn({
    get: jest.fn(async (ref: any) => ({ exists: true, docs: [], data: () => schedules.get(ref.id) })),
    create: jest.fn((_r: any, d: any) => { tasks.push(d); }),
    update: jest.fn((r: any, d: any) => { writes.push({ id: r.id, d }); schedules.set(r.id, { ...schedules.get(r.id), ...d }); }),
  })),
};
jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn(() => mockDb) }));

import { executeSchedulesForUser } from "../modules/schedule-executor";

const past = "2020-01-01T00:00:00.000Z";
const taskSched = () => ({ name: "nightly", target: "iso", cron: "0 0 * * *", enabled: true, nextRunAt: past, taskTemplate: { title: "t" } });
const watchSched = () => ({
  name: "wd", target: "iso", cron: "0 0 * * *", enabled: true, nextRunAt: past, kind: "watch",
  watch: { scheduleId: "x", status: "created", withinHours: 1 },
});

let errSpy: jest.SpyInstance;
beforeEach(() => {
  schedules.clear(); tasks.length = 0; writes.length = 0; (mockDb as any)._second = false;
  readDispatchPause.mockReset();
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe("schedule executor under dispatchPaused", () => {
  it("paused: a due task schedule creates 0 tasks, keeps nextRunAt, reports skipped 1, logs the exact line", async () => {
    readDispatchPause.mockResolvedValue("paused");
    schedules.set("s1", taskSched());
    const r = await executeSchedulesForUser("u1");
    expect(tasks).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(schedules.get("s1").nextRunAt).toBe(past);
    expect(r).toMatchObject({ skipped: 1, errors: 0, fired: [] });
    expect(errSpy).toHaveBeenCalledWith(`[ScheduleExecutor] DISPATCH_PAUSED skip tenant=u1 schedule=s1 name=nightly nextRunAt=${past}`);
    expect(readDispatchPause).toHaveBeenCalledTimes(1);
  });

  it("paused: a kind-less schedule counts as a task schedule; a watch schedule still fires", async () => {
    readDispatchPause.mockResolvedValue("paused");
    schedules.set("s1", taskSched());
    schedules.set("w1", watchSched());
    const r = await executeSchedulesForUser("u1");
    expect(r.skipped).toBe(1);
    expect(r.fired.map((f) => f.scheduleId)).toEqual(["w1"]);
    expect(schedules.get("w1").nextRunAt).not.toBe(past);
    expect(schedules.get("s1").nextRunAt).toBe(past);
  });

  it("flag read fails: skips task schedules, errors 1, creates 0 tasks", async () => {
    readDispatchPause.mockResolvedValue("unknown");
    schedules.set("s1", taskSched());
    const r = await executeSchedulesForUser("u1");
    expect(tasks).toHaveLength(0);
    expect(r).toMatchObject({ errors: 1, skipped: 1 });
    expect(schedules.get("s1").nextRunAt).toBe(past);
  });

  it("after the flag clears, the same schedule fires once", async () => {
    schedules.set("s1", taskSched());
    readDispatchPause.mockResolvedValueOnce("paused");
    await executeSchedulesForUser("u1");
    expect(tasks).toHaveLength(0);
    (mockDb as any)._second = false;
    readDispatchPause.mockResolvedValueOnce("clear");
    const r = await executeSchedulesForUser("u1");
    expect(tasks).toHaveLength(1);
    expect(r).toMatchObject({ skipped: 0, errors: 0 });
    expect(r.fired).toHaveLength(1);
    expect(schedules.get("s1").nextRunAt).not.toBe(past);
  });
});
