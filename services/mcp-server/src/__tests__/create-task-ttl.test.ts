/**
 * PLAN-W2b — create_task must reach the never-expires sentinel too.
 *
 * Sibling to dispatch-ttl.test.ts (PLAN-W2). create_task had the identical
 * falsy-broken `args.ttl || default` idiom, plus a second defect: any type
 * other than "task" with no explicit ttl wrote NO expiresAt field at all —
 * the source of the field-less-document population PLAN-W1 backfills and
 * PLAN-W4's reaper must never mistake for "already expired".
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
  classifyTask: jest.fn(() => "WORK"),
}));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCreated: jest.fn() }));
jest.mock("../webhooks/dispatcher-notify.js", () => ({ notifyDispatcher: jest.fn() }));
jest.mock("../modules/programRegistry.js", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../modules/wake/onDemandWake.js", () => ({
  queryTargetState: jest.fn(() => Promise.resolve({ targetState: "alive", heartbeatAge: "1m" })),
}));

import { createTaskHandler } from "../modules/dispatch/tasks.js";
import type { AuthContext } from "../auth/authValidator.js";
import { CONSTANTS } from "../config/constants.js";

const mockData: Record<string, any> = {};

const mockFirestore = {
  collection: jest.fn((path: string) => ({
    add: jest.fn((data: any) => {
      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      mockData[`${path}/${id}`] = data;
      return Promise.resolve({ id });
    }),
  })),
  doc: jest.fn((path: string) => ({
    get: jest.fn(() => Promise.resolve({ exists: !!mockData[path], data: () => mockData[path] })),
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockFirestore),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

beforeEach(() => {
  Object.keys(mockData).forEach((key) => delete mockData[key]);
  jest.clearAllMocks();
});

const mockAuth: AuthContext = {
  userId: "test-user",
  programId: "iso",
  keyProgramId: "iso",
  apiKeyHash: "test-hash",
  capabilities: ["dispatch.write"],
  encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
  rateLimitTier: "internal",
};

function getCreatedTask() {
  const entry = Object.entries(mockData).find(([key]) => key.startsWith("tenants/test-user/tasks/"));
  if (!entry) throw new Error("no task doc created");
  return entry[1];
}

describe("PLAN-W2b: create_task ttl + always-write-expiresAt", () => {
  it("NEGATIVE (falsy trap): ttl:0 on a task yields the 2099 sentinel exactly, not ~24h", async () => {
    await createTaskHandler(mockAuth, {
      source: "iso",
      target: "basher",
      title: "Carry-forward rescue",
      type: "task",
      ttl: 0,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(0);
    expect(task.expiresAt.toDate().getTime()).toBe(
      new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime()
    );
    const in25Hours = Date.now() + 25 * 3600 * 1000;
    expect(task.expiresAt.toMillis()).toBeGreaterThan(in25Hours);
  });

  it("honours an explicit ttl; taskData.ttl and expiresAt agree", async () => {
    const before = Date.now();
    await createTaskHandler(mockAuth, {
      source: "iso",
      target: "basher",
      title: "Custom ttl",
      type: "task",
      ttl: 300,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(300);
    const expiresAtMs = task.expiresAt.toMillis();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 300_000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it("type=sprint with no ttl now writes the sentinel and the field is PRESENT (closes the field-less-document source)", async () => {
    await createTaskHandler(mockAuth, {
      source: "iso",
      target: "basher",
      title: "Sprint with no explicit ttl",
      type: "sprint",
    });

    const task = getCreatedTask();
    expect(task.expiresAt).toBeDefined();
    expect(task.expiresAt).not.toBeNull();
    expect(task.expiresAt.toDate().getTime()).toBe(
      new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime()
    );
    expect(task.ttl).toBe(0);
  });

  it("type=task with no ttl is unchanged: still defaults to 86400s", async () => {
    await createTaskHandler(mockAuth, {
      source: "iso",
      target: "basher",
      title: "Default task ttl",
      type: "task",
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(86400);
    expect(task.ttl).toBe(CONSTANTS.ttl.defaultTaskSeconds);
    const in23Hours = Date.now() + 23 * 3600 * 1000;
    const in25Hours = Date.now() + 25 * 3600 * 1000;
    expect(task.expiresAt.toMillis()).toBeGreaterThan(in23Hours);
    expect(task.expiresAt.toMillis()).toBeLessThan(in25Hours);
  });

  it("rejects a negative ttl at the schema boundary", async () => {
    await expect(
      createTaskHandler(mockAuth, {
        source: "iso",
        target: "basher",
        title: "Invalid ttl",
        ttl: -1,
      })
    ).rejects.toThrow();
  });
});
