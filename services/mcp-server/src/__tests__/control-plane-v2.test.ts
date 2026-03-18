/**
 * Control Plane v2 Test Suite — Quarantine, Replay, Policy Modes
 *
 * Tests for Wave 7 features:
 * - Auto-quarantine on failure threshold
 * - Task replay with modifications
 * - Per-task policy modes (normal, supervised, strict)
 *
 * Uses mock-based testing (not Firestore emulator).
 */

// Mock github-sync to avoid @octokit/rest ESM import issues in Jest
jest.mock("../modules/github-sync.js", () => ({
  syncTaskCreated: jest.fn(),
  syncTaskCompleted: jest.fn(),
  reconcileGitHub: jest.fn(),
}));

import { quarantineProgramHandler, unquarantineProgramHandler, replayTaskHandler, approveTaskHandler } from "../modules/dispatch/interventions.js";
import { completeTaskHandler } from "../modules/dispatch/completion.js";
import { dispatchHandler } from "../modules/dispatch/dispatchHandler.js";
import { isProgramQuarantined } from "../modules/pulse.js";
import type { AuthContext } from "../auth/authValidator.js";
import * as admin from "firebase-admin";

// Mock program registry
jest.mock("../modules/programRegistry.js", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
  registerProgram: jest.fn(() => Promise.resolve()),
  seedPrograms: jest.fn(() => Promise.resolve()),
}));

// Mock events
jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
  computeHash: jest.fn((str: string) => `hash_${str.substring(0, 10)}`),
  classifyTask: jest.fn(() => "WORK"),
}));

// Mock analytics
jest.mock("../modules/analytics.js", () => ({
  emitAnalyticsEvent: jest.fn(),
}));

// Mock wake module
jest.mock("../modules/wake/index.js", () => ({
  wakeTarget: jest.fn(() => Promise.resolve({ outcome: "already_alive", targetState: "alive" })),
  queryTargetState: jest.fn(() => Promise.resolve({ targetState: "alive", heartbeatAge: "2m", heartbeatAgeMs: 120000 })),
}));

// Mock governance
jest.mock("../modules/dispatch/governance.js", () => ({
  checkGovernanceRules: jest.fn(() => ({ warnings: [] })),
}));

// Track Firestore data in memory
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

// Mock Firestore
const mockFirestore = {
  collection: jest.fn((path: string) => ({
    add: jest.fn((data: any) => {
      const id = `task_${Date.now()}`;
      const fullPath = `${path}/${id}`;
      mockData[fullPath] = data;
      return Promise.resolve({ id, path: fullPath, _path: fullPath });
    }),
    where: jest.fn(() => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ docs: [], size: 0, empty: true })),
        })),
        get: jest.fn(() => Promise.resolve({ docs: [], size: 0, empty: true })),
      })),
      get: jest.fn(() => Promise.resolve({ docs: [], size: 0, empty: true })),
    })),
    orderBy: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ docs: [], size: 0, empty: true })),
      })),
    })),
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

// Reset mock data before each test
beforeEach(() => {
  Object.keys(mockData).forEach(key => delete mockData[key]);
  jest.clearAllMocks();
});

const mockAuth: AuthContext = {
  userId: "test-user",
  programId: "iso",
  apiKeyHash: "test-hash",
  capabilities: ["dispatch.write"],
  encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
  rateLimitTier: "internal",
};

// ─── AUTO-QUARANTINE TESTS ───────────────────────────────────────────────────

describe("Auto-Quarantine", () => {
  it("should quarantine a program manually", async () => {
    const result = await quarantineProgramHandler(mockAuth, {
      programId: "builder-test",
      reason: "Manual quarantine for testing",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.quarantined).toBe(true);
    expect(data.programId).toBe("builder-test");

    // Verify program doc was updated
    const programPath = "tenants/test-user/programs/builder-test";
    expect(mockData[programPath]).toBeDefined();
    expect(mockData[programPath].quarantined).toBe(true);
    expect(mockData[programPath].quarantineReason).toBe("Manual quarantine for testing");
  });

  it("should unquarantine a program", async () => {
    // First quarantine
    mockData["tenants/test-user/programs/builder-test"] = {
      quarantined: true,
      quarantinedAt: admin.firestore.Timestamp.now(),
      quarantineReason: "Test",
      failureCount: 5,
    };

    const result = await unquarantineProgramHandler(mockAuth, {
      programId: "builder-test",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.quarantined).toBe(false);

    // Verify program doc was updated
    const programPath = "tenants/test-user/programs/builder-test";
    expect(mockData[programPath].quarantined).toBe(false);
    expect(mockData[programPath].failureCount).toBe(0);
  });

  it("should prevent unquarantining a non-quarantined program", async () => {
    // Program not quarantined
    mockData["tenants/test-user/programs/builder-test"] = {
      quarantined: false,
    };

    const result = await unquarantineProgramHandler(mockAuth, {
      programId: "builder-test",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("not quarantined");
  });

  it("should check if program is quarantined", async () => {
    // Not quarantined
    mockData["tenants/test-user/programs/builder-test"] = {
      quarantined: false,
    };
    let isQuarantined = await isProgramQuarantined("test-user", "builder-test");
    expect(isQuarantined).toBe(false);

    // Quarantined
    mockData["tenants/test-user/programs/builder-test"] = {
      quarantined: true,
    };
    isQuarantined = await isProgramQuarantined("test-user", "builder-test");
    expect(isQuarantined).toBe(true);
  });
});

// ─── TASK REPLAY TESTS ────────────────────────────────────────────────────────

describe("Task Replay", () => {
  it("should replay a completed task", async () => {
    // Create original task
    const taskId = "task_original";
    const originalTaskPath = `tenants/test-user/tasks/${taskId}`;
    mockData[originalTaskPath] = {
      schemaVersion: "2.2",
      type: "task",
      title: "Original Task",
      instructions: "Do something",
      source: "iso",
      target: "builder-test",
      priority: "normal",
      action: "queue",
      status: "done",
      completed_status: "SUCCESS",
    };

    const result = await replayTaskHandler(mockAuth, {
      taskId,
      modifiedInstructions: "Do something different",
      newTarget: "vector",
      newPriority: "high",
      reason: "Testing replay",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.originalTaskId).toBe(taskId);
    expect(data.newTaskId).toBeDefined();
    expect(data.modifications).toContain("instructions");
    expect(data.modifications.some((m: string) => m.includes("target"))).toBe(true);
    expect(data.modifications.some((m: string) => m.includes("priority"))).toBe(true);

    // Verify new task was created
    const newTaskPath = Object.keys(mockData).find(k => k.includes("tasks") && k !== originalTaskPath);
    expect(newTaskPath).toBeDefined();
    if (newTaskPath) {
      const newTask = mockData[newTaskPath];
      expect(newTask.instructions).toBe("Do something different");
      expect(newTask.target).toBe("vector");
      expect(newTask.priority).toBe("high");
      expect(newTask.replayOf).toBe(taskId);
      expect(newTask.replayReason).toBe("Testing replay");
      expect(newTask.status).toBe("created");
    }
  });

  it("should replay without modifications", async () => {
    // Create original task
    const taskId = "task_exact_replay";
    const originalTaskPath = `tenants/test-user/tasks/${taskId}`;
    mockData[originalTaskPath] = {
      schemaVersion: "2.2",
      type: "task",
      title: "Exact Replay Task",
      instructions: "Same instructions",
      source: "iso",
      target: "builder-test",
      priority: "normal",
      status: "done",
    };

    const result = await replayTaskHandler(mockAuth, {
      taskId,
      reason: "Exact replay test",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.modifications).toContain("none (exact replay)");
  });

  it("should reject replay of non-existent task", async () => {
    const result = await replayTaskHandler(mockAuth, {
      taskId: "nonexistent",
      reason: "Test",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("not found");
  });
});

// ─── POLICY MODES TESTS ───────────────────────────────────────────────────────

describe("Policy Modes", () => {
  it("should block dispatch in strict mode when governance warnings present", async () => {
    const { checkGovernanceRules } = require("../modules/dispatch/governance.js");
    checkGovernanceRules.mockReturnValueOnce({ warnings: ["[test_warning] Test warning"] });

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Strict mode test",
      instructions: "Test task",
      policy_mode: "strict",
      waitForUptake: false,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Strict policy violation");
    expect(data.governance_warnings).toBeDefined();
  });

  it("should allow dispatch in normal mode with governance warnings", async () => {
    const { checkGovernanceRules } = require("../modules/dispatch/governance.js");
    checkGovernanceRules.mockReturnValueOnce({ warnings: ["[test_warning] Advisory warning"] });

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Normal mode test",
      instructions: "Test task",
      policy_mode: "normal",
      waitForUptake: false,
    });

    const data = JSON.parse(result.content[0].text);
    // Should succeed (governance warnings are advisory in normal mode)
    expect(data.taskId).toBeDefined();
  });

  it("should approve a supervised task", async () => {
    // Create task in completing status with awaitingApproval
    const taskId = "task_supervised";
    const taskPath = `tenants/test-user/tasks/${taskId}`;
    mockData[taskPath] = {
      status: "completing",
      awaitingApproval: true,
      policy_mode: "supervised",
      completed_status: "SUCCESS",
    };

    const result = await approveTaskHandler(mockAuth, { taskId });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.taskId).toBe(taskId);

    // Verify task transitioned to done
    expect(mockData[taskPath].status).toBe("done");
    expect(mockData[taskPath].awaitingApproval).toBe(false);
    expect(mockData[taskPath].approvedBy).toBe("iso");
  });

  it("should reject approval of non-completing task", async () => {
    const taskId = "task_not_completing";
    const taskPath = `tenants/test-user/tasks/${taskId}`;
    mockData[taskPath] = {
      status: "active",
      awaitingApproval: false,
    };

    const result = await approveTaskHandler(mockAuth, { taskId });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("cannot be approved");
  });

  it("should reject approval of task not awaiting approval", async () => {
    const taskId = "task_not_awaiting";
    const taskPath = `tenants/test-user/tasks/${taskId}`;
    mockData[taskPath] = {
      status: "completing",
      awaitingApproval: false,
    };

    const result = await approveTaskHandler(mockAuth, { taskId });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain("not awaiting approval");
  });
});
