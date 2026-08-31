/**
 * PLAN-W2 — dispatch() must honour a caller-supplied ttl.
 *
 * Gate for the Firestore reaper: expiresAt was previously a lie for carry-forward
 * work (dispatch() hardcoded a 24h TTL with no caller override). These tests prove
 * the fix and, specifically, that the never-expires encoding survives the
 * `args.ttl || default` falsy trap (ttl: 0 is falsy but must NOT fall through to
 * the default and must NOT be rejected by schema validation).
 *
 * Mock scaffolding mirrors control-plane-v2.test.ts (mock-based, not the emulator).
 */

// Mock github-sync to avoid @octokit/rest ESM import issues in Jest
jest.mock("../modules/github-sync.js", () => ({
  syncTaskCreated: jest.fn(),
  syncTaskCompleted: jest.fn(),
  reconcileGitHub: jest.fn(),
}));

import { dispatchHandler } from "../modules/dispatch/dispatchHandler.js";
import type { AuthContext } from "../auth/authValidator.js";
import { CONSTANTS } from "../config/constants.js";
import * as admin from "firebase-admin";

jest.setTimeout(20_000);

jest.mock("../modules/programRegistry.js", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
  registerProgram: jest.fn(() => Promise.resolve()),
  seedPrograms: jest.fn(() => Promise.resolve()),
}));

jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
  computeHash: jest.fn((str: string) => `hash_${str.substring(0, 10)}`),
  classifyTask: jest.fn(() => "WORK"),
}));

jest.mock("../modules/analytics.js", () => ({
  emitAnalyticsEvent: jest.fn(),
}));

jest.mock("../modules/wake/index.js", () => ({
  wakeTarget: jest.fn(() => Promise.resolve({ outcome: "already_alive", targetState: "alive" })),
  queryTargetState: jest.fn(() => Promise.resolve({ targetState: "alive", heartbeatAge: "2m", heartbeatAgeMs: 120000 })),
}));

jest.mock("../modules/dispatch/governance.js", () => ({
  checkGovernanceRules: jest.fn(() => ({ warnings: [] })),
}));

const mockData: Record<string, any> = {};

const createMockDoc = (path: string) => ({
  exists: !!mockData[path],
  data: () => mockData[path],
  get: jest.fn(() => Promise.resolve({
    exists: !!mockData[path],
    data: () => mockData[path],
  })),
});

const createMockTransaction = () => {
  const txData = { ...mockData };
  return {
    get: jest.fn((ref: any) => {
      const path = ref._path || ref.path;
      return Promise.resolve({
        exists: !!txData[path],
        data: () => txData[path],
      });
    }),
    set: jest.fn((ref: any, data: any, options?: any) => {
      const path = ref._path || ref.path;
      if (options?.merge) {
        txData[path] = { ...(txData[path] || {}), ...data };
      } else {
        txData[path] = data;
      }
    }),
    update: jest.fn((ref: any, data: any) => {
      const path = ref._path || ref.path;
      txData[path] = { ...(txData[path] || {}), ...data };
    }),
    commit: jest.fn(() => {
      Object.assign(mockData, txData);
      return Promise.resolve();
    }),
  };
};

const createMockQuery = (path: string, filters: Array<[string, string, any]> = []) => {
  const query: any = {
    where: jest.fn((field: string, op: string, value: any) =>
      createMockQuery(path, [...filters, [field, op, value]])
    ),
    limit: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    get: jest.fn(() => {
      const docs = Object.entries(mockData)
        .filter(([key]) => key.startsWith(`${path}/`))
        .filter(([, value]) =>
          filters.every(([field, op, expected]) => op === "==" && value?.[field] === expected)
        )
        .map(([key, value]) => ({
          id: key.split("/").pop(),
          exists: true,
          data: () => value,
        }));
      return Promise.resolve({ docs, size: docs.length, empty: docs.length === 0 });
    }),
  };
  return query;
};

const mockFirestore = {
  collection: jest.fn((path: string) => ({
    add: jest.fn((data: any) => {
      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fullPath = `${path}/${id}`;
      mockData[fullPath] = data;
      return Promise.resolve({ id, path: fullPath, _path: fullPath });
    }),
    get: createMockQuery(path).get,
    where: createMockQuery(path).where,
    orderBy: createMockQuery(path).orderBy,
    limit: createMockQuery(path).limit,
  })),
  doc: jest.fn((path: string) => ({
    get: jest.fn(() => Promise.resolve(createMockDoc(path))),
    set: jest.fn((data: any, options?: any) => {
      if (options?.merge) {
        mockData[path] = { ...(mockData[path] || {}), ...data };
      } else {
        mockData[path] = data;
      }
      return Promise.resolve();
    }),
    update: jest.fn((data: any) => {
      mockData[path] = { ...(mockData[path] || {}), ...data };
      return Promise.resolve();
    }),
    path,
    _path: path,
  })),
  runTransaction: jest.fn((callback: any) => {
    const tx = createMockTransaction();
    return callback(tx).then((result: any) => {
      tx.commit();
      return result;
    });
  }),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockFirestore),
  serverTimestamp: jest.fn(() => admin.firestore.Timestamp.now()),
}));

beforeEach(() => {
  Object.keys(mockData).forEach((key) => delete mockData[key]);
  delete process.env.DISPATCH_CALLER_BOUNDARY_TIMEOUT_MS;
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
  const entry = Object.entries(mockData).find(
    ([key, value]) => key.startsWith("tenants/test-user/tasks/") && value?.title
  );
  if (!entry) throw new Error("no task doc created");
  return entry[1];
}

describe("PLAN-W2: dispatch() ttl", () => {
  it("honours a caller-supplied ttl and keeps taskData.ttl and expiresAt in agreement", async () => {
    const before = Date.now();
    await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Custom ttl dispatch",
      instructions: "Should live for exactly 120s",
      action: "queue",
      ttl: 120,
      waitForUptake: false,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(120);
    const expiresAtMs = task.expiresAt.toMillis();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 120_000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it("defaults action:queue (non-interrupt) to the standard 86400s when ttl is omitted", async () => {
    await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Default queue dispatch",
      instructions: "No ttl specified",
      action: "queue",
      waitForUptake: false,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(86400);
    expect(task.ttl).toBe(CONSTANTS.ttl.defaultTaskSeconds);
  });

  it("NEGATIVE: omitting ttl on an interrupt dispatch defaults to 604800s, not 86400s", async () => {
    await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Interrupt-class directive",
      instructions: "Must survive a context recycle",
      action: "interrupt",
      waitForUptake: false,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(604800);
    expect(task.ttl).toBe(CONSTANTS.ttl.interruptTaskSeconds);
    expect(task.ttl).not.toBe(86400);
  });

  it("NEGATIVE (falsy trap): ttl:0 yields the 2099 never-expires sentinel, not a 24h task", async () => {
    await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Carry-forward work that must never be reaped",
      instructions: "ttl: 0 is falsy — must not fall through to the default",
      action: "queue",
      ttl: 0,
      waitForUptake: false,
    });

    const task = getCreatedTask();
    expect(task.ttl).toBe(0);
    expect(task.expiresAt.toDate().getTime()).toBe(
      new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime()
    );
    // The falsy trap: `args.ttl || default` would have produced ~24h from now, not 2099.
    const in25Hours = Date.now() + 25 * 3600 * 1000;
    expect(task.expiresAt.toMillis()).toBeGreaterThan(in25Hours);
  });

  it("rejects a negative ttl at the schema boundary", async () => {
    await expect(
      dispatchHandler(mockAuth, {
        source: "iso",
        target: "builder-test",
        title: "Invalid ttl",
        ttl: -5,
        waitForUptake: false,
      })
    ).rejects.toThrow();
  });
});
