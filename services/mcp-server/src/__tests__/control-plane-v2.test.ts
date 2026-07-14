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

jest.setTimeout(20_000);

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
const queryFilterChains: Array<Array<[string, string, any]>> = [];

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
const createMockQuery = (path: string, filters: Array<[string, string, any]> = []) => {
  const query: any = {
    where: jest.fn((field: string, op: string, value: any) =>
      createMockQuery(path, [...filters, [field, op, value]])
    ),
    limit: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    get: jest.fn(() => {
      queryFilterChains.push(filters);
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
      const id = `task_${Date.now()}`;
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

// Reset mock data before each test
beforeEach(() => {
  Object.keys(mockData).forEach(key => delete mockData[key]);
  queryFilterChains.length = 0;
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

async function waitForDirectiveEntry() {
  for (let i = 0; i < 20; i++) {
    const relayEntry = Object.entries(mockData).find(([key, value]) =>
      key.startsWith("tenants/test-user/relay/") && value.message_type === "DIRECTIVE"
    );
    if (relayEntry) return relayEntry;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return undefined;
}

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
    // Governance warnings remain advisory, but skipped uptake is a tracked pending obligation.
    expect(data.success).toBe(false);
    expect(data.action_required).toBe("monitor_pending");
    expect(data.taskId).toBeDefined();
  });

  it("should return pending handle instead of false success when uptake wait is skipped", async () => {
    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Durable pending dispatch",
      instructions: "Track this until claim or ACK.",
      policy_mode: "normal",
      waitForUptake: false,
      idempotency_key: "pending-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.uptakeConfirmed).toBe(false);
    expect(data.action_required).toBe("monitor_pending");
    expect(data.deliveryState).toBe("notified");
    expect(data.pendingHandle).toMatchObject({
      obligationId: "dispatch:pending-contract-1",
      taskId: data.taskId,
      directiveId: data.directiveId,
      deliveryState: "notified",
    });

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:pending-contract-1"];
    expect(obligation).toBeDefined();
    expect(obligation.taskId).toBe(data.taskId);
    expect(obligation.directiveId).toBe(data.directiveId);
    expect(obligation.deliveryState).toBe("notified");
    expect(obligation.pendingReason).toBe("uptake_wait_skipped");
  });

  it("should confirm uptake from a valid target ACK only", async () => {
    const pending = dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Valid ACK dispatch",
      instructions: "ACK from target should satisfy uptake.",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
    });

    const relayEntry = await waitForDirectiveEntry();
    expect(relayEntry).toBeDefined();
    const directiveId = relayEntry![0].split("/").pop()!;
    mockData["tenants/test-user/relay/ack-decoy"] = {
      reply_to: directiveId,
      message_type: "STATUS",
      source: "builder-test",
      target: "iso",
      createdAt: admin.firestore.Timestamp.now(),
    };
    mockData["tenants/test-user/relay/ack-valid"] = {
      reply_to: directiveId,
      message_type: "ACK",
      source: "builder-test",
      target: "iso",
      createdAt: admin.firestore.Timestamp.now(),
    };

    const data = JSON.parse((await pending).content[0].text);

    expect(data.success).toBe(true);
    expect(data.uptakeConfirmed).toBe(true);
    expect(data.uptakeVia).toBe("ack");
    expect(data.ackId).toBe("ack-valid");
    expect(queryFilterChains).toContainEqual([["reply_to", "==", directiveId]]);
  });

  it("should reject spoofed ACKs from foreign programs", async () => {
    const pending = dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Spoofed ACK dispatch",
      instructions: "Foreign ACK must not satisfy uptake.",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
    });

    const relayEntry = await waitForDirectiveEntry();
    expect(relayEntry).toBeDefined();
    const directiveId = relayEntry![0].split("/").pop()!;
    mockData["tenants/test-user/relay/ack-spoof"] = {
      reply_to: directiveId,
      message_type: "ACK",
      source: "foreign-program",
      target: "iso",
      createdAt: admin.firestore.Timestamp.now(),
    };

    const data = JSON.parse((await pending).content[0].text);

    expect(data.success).toBe(false);
    expect(data.uptakeConfirmed).toBe(false);
    expect(data.ackId).toBeUndefined();
    expect(data.deliveryState).toBe("escalated");
  });

  it("should reuse an idempotent dispatch obligation without duplicate work", async () => {
    const args = {
      source: "iso",
      target: "builder-test",
      title: "Idempotent dispatch",
      instructions: "Retry-safe dispatch.",
      policy_mode: "normal",
      waitForUptake: false,
      idempotency_key: "dedupe-contract-1",
    };

    const first = JSON.parse((await dispatchHandler(mockAuth, args)).content[0].text);
    const second = JSON.parse((await dispatchHandler(mockAuth, args)).content[0].text);

    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.taskId).toBe(first.taskId);
    expect(second.directiveId).toBe(first.directiveId);
    expect(second.obligationId).toBe("dispatch:dedupe-contract-1");

    const taskDocs = Object.keys(mockData).filter((key) => key.startsWith("tenants/test-user/tasks/"));
    const directiveDocs = Object.keys(mockData).filter((key) => key.startsWith("tenants/test-user/relay/"));
    const obligationDocs = Object.keys(mockData).filter((key) => key.startsWith("tenants/test-user/dispatch_obligations/"));
    expect(taskDocs).toHaveLength(1);
    expect(directiveDocs).toHaveLength(1);
    expect(obligationDocs).toHaveLength(1);
  });

  it("should resume an idempotent dispatch after a late claim", async () => {
    const args = {
      source: "iso",
      target: "builder-test",
      title: "Late claim dispatch",
      instructions: "Client timed out before target claimed.",
      policy_mode: "normal",
      waitForUptake: false,
      idempotency_key: "late-claim-contract-1",
      uptakeTimeoutSeconds: 5,
    };

    const first = JSON.parse((await dispatchHandler(mockAuth, args)).content[0].text);
    mockData[`tenants/test-user/tasks/${first.taskId}`] = {
      ...mockData[`tenants/test-user/tasks/${first.taskId}`],
      status: "active",
      claimedBy: "builder-test",
      claimedAt: admin.firestore.Timestamp.now(),
    };

    const resumed = JSON.parse((await dispatchHandler(mockAuth, {
      ...args,
      waitForUptake: true,
    })).content[0].text);

    expect(resumed.idempotent).toBe(true);
    expect(resumed.taskId).toBe(first.taskId);
    expect(resumed.success).toBe(true);
    expect(resumed.uptakeConfirmed).toBe(true);
    expect(resumed.uptakeVia).toBe("claim");
    expect(resumed.claimedBy).toBe("builder-test");
    expect(mockData["tenants/test-user/dispatch_obligations/dispatch:late-claim-contract-1"].deliveryState).toBe("claimed");
  });

  it("should reject paused targets with a durable pending handle", async () => {
    mockData["tenants/test-user/programs/builder-test"] = {
      paused: true,
    };

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Paused target dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      idempotency_key: "paused-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.deliveryState).toBe("rejected");
    expect(data.action_required).toBe("monitor_pending");
    expect(data.pendingHandle).toMatchObject({
      obligationId: "dispatch:paused-contract-1",
      deliveryState: "rejected",
    });
    expect(mockData["tenants/test-user/dispatch_obligations/dispatch:paused-contract-1"].rejectionReason).toBe("target_paused");
  });

  it("should track absent non-spawnable target as pending spawn work, not success", async () => {
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockResolvedValueOnce({
      targetState: "absent",
      heartbeatAge: "never",
      heartbeatAgeMs: Infinity,
    });
    wakeModule.wakeTarget.mockResolvedValueOnce({
      outcome: "not_spawnable",
      targetState: "absent",
      heartbeatAge: "never",
      heartbeatAgeMs: Infinity,
    });

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Absent target dispatch",
      policy_mode: "normal",
      waitForUptake: false,
      autoWake: true,
      idempotency_key: "absent-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.targetState).toBe("absent");
    expect(data.wakeAttempted).toBe(true);
    expect(data.wakeResult).toBe("not_spawnable");
    expect(data.action_required).toBe("spawn_target");
    expect(data.pendingHandle).toBeDefined();

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:absent-contract-1"];
    expect(obligation).toBeDefined();
    expect(obligation.targetState).toBe("absent");
    expect(obligation.wakeAttempted).toBe(true);
    expect(obligation.wakeResult).toBe("not_spawnable");
  });

  it("should escalate wedged wake timeouts with a durable proof path", async () => {
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockResolvedValueOnce({
      targetState: "stale",
      heartbeatAge: "30m",
      heartbeatAgeMs: 30 * 60 * 1000,
    });
    wakeModule.wakeTarget.mockResolvedValueOnce({
      outcome: "timeout",
      targetState: "stale",
      heartbeatAge: "30m",
      heartbeatAgeMs: 30 * 60 * 1000,
    });

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Wedged target dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      autoWake: true,
      idempotency_key: "wedged-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.targetState).toBe("stale");
    expect(data.wakeAttempted).toBe(true);
    expect(data.wakeResult).toBe("timeout");
    expect(data.deliveryState).toBe("escalated");
    expect(data.action_required).toBe("spawn_target");

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:wedged-contract-1"];
    expect(obligation.taskId).toBe(data.taskId);
    expect(obligation.directiveId).toBe(data.directiveId);
    expect(obligation.deliveryState).toBe("escalated");
    expect(obligation.escalationReason).toBe("target_unavailable");
    expect(obligation.wakeAttempted).toBe(true);
    expect(obligation.wakeResult).toBe("timeout");
  });

  it("should confirm a claim that occurs during wake without an extra poll interval", async () => {
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockResolvedValueOnce({
      targetState: "stale",
      heartbeatAge: "30m",
      heartbeatAgeMs: 30 * 60 * 1000,
    });
    wakeModule.wakeTarget.mockImplementationOnce(async () => {
      const taskPath = Object.keys(mockData).find((key) => key.startsWith("tenants/test-user/tasks/"))!;
      mockData[taskPath] = {
        ...mockData[taskPath],
        status: "active",
        claimedBy: "builder-test",
        claimedAt: admin.firestore.Timestamp.now(),
      };
      return {
        outcome: "success",
        targetState: "alive",
        heartbeatAge: "1s",
        heartbeatAgeMs: 1000,
      };
    });

    const startedAt = Date.now();
    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Claim during wake dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      autoWake: true,
      idempotency_key: "claim-during-wake-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(data.success).toBe(true);
    expect(data.uptakeConfirmed).toBe(true);
    expect(data.uptakeVia).toBe("claim");
    expect(data.claimedBy).toBe("builder-test");
    expect(wakeModule.wakeTarget).toHaveBeenCalledWith(expect.objectContaining({
      waitForAlive: false,
    }));
  });

  it("should return a pending handle before the caller boundary timeout", async () => {
    process.env.DISPATCH_CALLER_BOUNDARY_TIMEOUT_MS = "50";
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockResolvedValueOnce({
      targetState: "stale",
      heartbeatAge: "30m",
      heartbeatAgeMs: 30 * 60 * 1000,
    });
    wakeModule.wakeTarget.mockImplementationOnce(() =>
      new Promise((resolve) => setTimeout(() => resolve({
        outcome: "success",
        targetState: "alive",
        heartbeatAge: "1s",
        heartbeatAgeMs: 1000,
      }), 75))
    );

    const startedAt = Date.now();
    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Caller boundary dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      autoWake: true,
      idempotency_key: "caller-boundary-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(Date.now() - startedAt).toBeLessThan(125);
    expect(data.success).toBe(false);
    expect(data.uptakeConfirmed).toBe(false);
    expect(data.deliveryState).toBe("notified");
    expect(data.action_required).toBe("monitor_pending");
    expect(data.pendingHandle).toMatchObject({
      obligationId: "dispatch:caller-boundary-contract-1",
      taskId: data.taskId,
      directiveId: data.directiveId,
      deliveryState: "notified",
    });

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:caller-boundary-contract-1"];
    expect(obligation.deliveryState).toBe("notified");
    expect(obligation.pendingReason).toBe("caller_boundary_deadline");
    expect(obligation.escalationReason).toBeUndefined();
  });

  it("should return a pending handle when preflight exhausts the caller boundary", async () => {
    process.env.DISPATCH_CALLER_BOUNDARY_TIMEOUT_MS = "50";
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockImplementationOnce(() =>
      new Promise((resolve) => setTimeout(() => resolve({
        targetState: "alive",
        heartbeatAge: "1s",
        heartbeatAgeMs: 1000,
      }), 75))
    );

    const startedAt = Date.now();
    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Slow preflight dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      autoWake: true,
      idempotency_key: "slow-preflight-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(Date.now() - startedAt).toBeLessThan(125);
    expect(data.success).toBe(false);
    expect(data.uptakeConfirmed).toBe(false);
    expect(data.deliveryState).toBe("notified");
    expect(data.action_required).toBe("monitor_pending");
    expect(data.pendingHandle).toMatchObject({
      obligationId: "dispatch:slow-preflight-contract-1",
      taskId: data.taskId,
      directiveId: data.directiveId,
      deliveryState: "notified",
    });

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:slow-preflight-contract-1"];
    expect(obligation.deliveryState).toBe("notified");
    expect(obligation.pendingReason).toBe("caller_boundary_deadline");
    expect(obligation.escalationReason).toBeUndefined();
    expect(wakeModule.wakeTarget).not.toHaveBeenCalled();
  });

  it("should return a pending handle when preflight throws after durable persistence", async () => {
    const wakeModule = require("../modules/wake/index.js");
    wakeModule.queryTargetState.mockRejectedValueOnce(new Error("preflight backend unavailable"));

    const result = await dispatchHandler(mockAuth, {
      source: "iso",
      target: "builder-test",
      title: "Preflight throw dispatch",
      policy_mode: "normal",
      waitForUptake: true,
      uptakeTimeoutSeconds: 5,
      idempotency_key: "preflight-throw-contract-1",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(false);
    expect(data.uptakeConfirmed).toBe(false);
    expect(data.deliveryState).toBe("escalated");
    expect(data.action_required).toBe("monitor_pending");
    expect(data.taskId).toBeDefined();
    expect(data.directiveId).toBeDefined();
    expect(data.pendingHandle).toMatchObject({
      obligationId: "dispatch:preflight-throw-contract-1",
      taskId: data.taskId,
      directiveId: data.directiveId,
      deliveryState: "escalated",
    });
    expect(data.message).toContain("runtime preflight failed");

    const obligation = mockData["tenants/test-user/dispatch_obligations/dispatch:preflight-throw-contract-1"];
    expect(obligation.taskId).toBe(data.taskId);
    expect(obligation.directiveId).toBe(data.directiveId);
    expect(obligation.deliveryState).toBe("escalated");
    expect(obligation.escalationReason).toBe("preflight_failed");
    expect(obligation.runtimeFailure).toMatchObject({
      reason: "preflight_failed",
      message: "preflight backend unavailable",
    });
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
