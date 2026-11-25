/**
 * PLAN-W2e re-census — schedule-executor.ts fired a task doc with no expiresAt
 * at all on every schedule tick. type:"task" with no explicit ttl now gets the
 * same 24h default create_task itself applies in that case (PLAN-W2b), not the
 * never-expires sentinel: a scheduled tick is ordinary actionable work for its
 * target, not open-ended state like a sprint or an unanswered question.
 * A taskTemplate.ttl (integer seconds, >= 60) overrides that default; an
 * invalid stored value falls back to it.
 */

jest.mock("../middleware/circuitBreaker.js", () => ({ readDispatchPause: jest.fn(async () => "clear") })); // PR-G: flag read is not under test here
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));

import { executeSchedulesForUser } from "../modules/schedule-executor.js";
import { CONSTANTS } from "../config/constants.js";

const scheduleDoc = { id: "sched-1", ref: { id: "sched-1" }, data: () => ({ name: "nightly" }) };
const created: any[] = [];

let templateOverride: Record<string, unknown> = {};

const txnStub = {
  get: jest.fn(() =>
    Promise.resolve({
      exists: true,
      data: () => ({
        enabled: true,
        nextRunAt: null,
        taskTemplate: { title: "Nightly job", ...templateOverride },
        cron: "0 0 * * *",
        name: "nightly",
      }),
    })
  ),
  create: jest.fn((_ref: any, data: any) => created.push(data)),
  update: jest.fn(),
};

let queryCall = 0;
const mockDb = {
  collection: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    get: jest.fn(() => {
      queryCall++;
      // First call: nextRunAt <= now (empty, avoids double count with the null-nextRunAt path).
      // Second call: nextRunAt == null -- the one due schedule.
      return Promise.resolve({ docs: queryCall % 2 === 1 ? [] : [scheduleDoc] });
    }),
    doc: jest.fn(() => ({ id: "task-1" })),
  })),
  runTransaction: jest.fn((fn: any) => fn(txnStub)),
};

jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn(() => mockDb) }));

beforeEach(() => {
  created.length = 0;
  templateOverride = {};
  queryCall = 0;
  jest.clearAllMocks();
});

describe("PLAN-W2e: schedule-executor.ts field-less writer", () => {
  it("a fired schedule's task doc carries ttl/expiresAt matching create_task's own type:task default", async () => {
    const result = await executeSchedulesForUser("test-user");

    expect(result.fired.length).toBe(1);
    expect(created.length).toBe(1);
    const task = created[0];
    expect(task.ttl).toBe(CONSTANTS.ttl.defaultTaskSeconds);
    expect(task.expiresAt).toBeDefined();
    const in23h = Date.now() + 23 * 3600 * 1000;
    const in25h = Date.now() + 25 * 3600 * 1000;
    expect(task.expiresAt.toMillis()).toBeGreaterThan(in23h);
    expect(task.expiresAt.toMillis()).toBeLessThan(in25h);
  });

  it("a template ttl of 3600 gives ttl 3600 and expiresAt about now+3600s", async () => {
    templateOverride = { ttl: 3600 };
    const before = Date.now();
    await executeSchedulesForUser("test-user");
    const after = Date.now();

    expect(created.length).toBe(1);
    const task = created[0];
    expect(task.ttl).toBe(3600);
    expect(task.expiresAt.toMillis()).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(task.expiresAt.toMillis()).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it.each([[0], [30], [59], ["3600"], [3600.5], [null]])(
    "a stored invalid template ttl (%p) falls back to the 24h default",
    async (bad) => {
      templateOverride = { ttl: bad };
      await executeSchedulesForUser("test-user");

      expect(created.length).toBe(1);
      const task = created[0];
      expect(task.ttl).toBe(CONSTANTS.ttl.defaultTaskSeconds);
      expect(task.ttl).toBe(86400);
      const in23h = Date.now() + 23 * 3600 * 1000;
      expect(task.expiresAt.toMillis()).toBeGreaterThan(in23h);
    }
  );
});
