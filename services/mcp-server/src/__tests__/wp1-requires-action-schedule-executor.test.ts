/**
 * WP-1 — schedule-executor.ts writes task documents directly, bypassing the
 * classifyRequiresAction() helper in dispatch/tasks.ts, and never set
 * requires_action at all. Once WP-2 lands a `.where("requires_action", "==",
 * true)` filter on get_tasks(), a fired schedule's task would silently vanish
 * from the boot query -- Firestore equality filters exclude docs missing the
 * field entirely. This test asserts the fired task doc explicitly carries
 * requires_action === true (scheduled work is actionable by default).
 *
 * Fails on pre-WP-1 code: the written task doc has no requires_action key at
 * all, so `expect(task.requires_action).toBe(true)` fails with
 * "expected true, received undefined".
 */

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));

import { executeSchedulesForUser } from "../modules/schedule-executor.js";

const scheduleDoc = { id: "sched-1", ref: { id: "sched-1" } };
const created: any[] = [];

const txnStub = {
  get: jest.fn(() =>
    Promise.resolve({
      exists: true,
      data: () => ({
        enabled: true,
        nextRunAt: null,
        taskTemplate: { title: "Nightly job", target: "iso" },
        cron: "0 0 * * *",
        name: "nightly",
        target: "iso",
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
      return Promise.resolve({ docs: queryCall % 2 === 1 ? [] : [scheduleDoc] });
    }),
    doc: jest.fn(() => ({ id: "task-1" })),
  })),
  runTransaction: jest.fn((fn: any) => fn(txnStub)),
};

jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn(() => mockDb) }));

beforeEach(() => {
  created.length = 0;
  queryCall = 0;
  jest.clearAllMocks();
});

describe("WP-1: schedule-executor.ts sets requires_action explicitly", () => {
  it("a fired schedule's task doc has requires_action === true", async () => {
    const result = await executeSchedulesForUser("test-user");

    expect(result.fired.length).toBe(1);
    expect(created.length).toBe(1);
    const task = created[0];
    expect(task.requires_action).toBe(true);
  });
});
