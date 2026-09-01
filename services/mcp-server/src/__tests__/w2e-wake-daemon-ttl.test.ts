/**
 * PLAN-W2e re-census — wake-daemon.ts's spawn-failure-threshold alert had the
 * exact same shape as signal.ts's original bug: the relay record got
 * ttl/expiresAt, its task mirror (written right after, for mobile visibility)
 * did not. Fix: the mirror now tracks the relay record's own ttl/expiresAt.
 */

jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../config/launch.js", () => ({
  SPAWNABLE_PROGRAMS: new Map([
    ["builder", { programId: "builder", spawnable: true, model: "opus", repo: "", description: "test" }],
  ]),
}));

import { pollAndWake } from "../lifecycle/wake-daemon.js";

const mockData: Record<string, any> = {};

const mockDb = {
  collection: jest.fn((path: string) => ({
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(() => {
      if (path.endsWith("/tasks")) {
        return Promise.resolve({ docs: [{ data: () => ({ target: "builder" }) }] });
      }
      // relay query (step 1) and sessions query (step 3): nothing pending/active
      return Promise.resolve({ docs: [], empty: true });
    }),
    add: jest.fn((data: any) => {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      mockData[`${path}/${id}`] = data;
      return Promise.resolve({ id });
    }),
    doc: jest.fn((id: string) => ({
      set: jest.fn((data: any) => {
        mockData[`${path}/${id}`] = data;
        return Promise.resolve();
      }),
    })),
  })),
};

jest.mock("../firebase/client.js", () => ({ getFirestore: jest.fn(() => mockDb) }));

const originalFetch = global.fetch;

beforeEach(() => {
  Object.keys(mockData).forEach((k) => delete mockData[k]);
  jest.clearAllMocks();
  global.fetch = jest.fn((url: any) => {
    if (String(url).endsWith("/health")) return Promise.resolve({ ok: true } as Response);
    return Promise.resolve({ ok: false } as Response); // every spawn attempt fails
  }) as any;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("PLAN-W2e: wake-daemon.ts field-less writer", () => {
  it("the spawn-failure-threshold alert's task mirror expiresAt matches its relay record exactly", async () => {
    // PROGRAM_SPAWN_FAILURE_THRESHOLD is 3 -- module-level state persists across
    // calls within this test file, so three consecutive failed spawns trip it.
    await pollAndWake("test-user");
    await pollAndWake("test-user");
    await pollAndWake("test-user");

    const relay = Object.entries(mockData).find(([k]) => k.startsWith("tenants/test-user/relay/"));
    const task = Object.entries(mockData).find(([k]) => k.startsWith("tenants/test-user/tasks/"));
    expect(relay).toBeDefined();
    expect(task).toBeDefined();
    const relayData = relay![1];
    const taskData = task![1];
    expect(taskData.ttl).toBe(3600);
    expect(taskData.expiresAt.toMillis()).toBe(relayData.expiresAt.toMillis());
  });
});
