/**
 * Task Lineage Tests — Wave 11
 *
 * Tests lineage field wiring, state transition logging,
 * lineage query chain resolution, and task export.
 */

// Mock external dependencies before imports
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(),
  serverTimestamp: jest.fn(() => "mock-server-timestamp"),
}));

jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
  classifyTask: jest.fn(() => "WORK"),
  computeHash: jest.fn(() => "mock-hash"),
}));

jest.mock("../modules/analytics.js", () => ({
  emitAnalyticsEvent: jest.fn(),
}));

jest.mock("../modules/github-sync.js", () => ({
  syncTaskCreated: jest.fn(),
  syncTaskClaimed: jest.fn(),
  syncTaskCompleted: jest.fn(),
}));

jest.mock("../modules/programRegistry.js", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("../lifecycle/engine.js", () => ({
  transition: jest.fn((entityType: string, from: string, to: string) => to),
  validateTransition: jest.fn(() => true),
}));

// Import AFTER mocks
import { buildTransition, appendTransition } from "../modules/dispatch/shared.js";
import type { StateTransition } from "../types/task.js";

describe("Wave 11: Task Lineage + State Transitions", () => {

  // ─── Story 1: Lineage Fields ──────────────────────────────────────────

  describe("Story 1: Lineage Fields", () => {
    it("Task interface accepts lineage fields", () => {
      // Type-level test: verify the shape compiles
      const task: Partial<import("../types/task.js").Task> = {
        id: "task-1",
        title: "Test task",
        status: "created",
        replayOf: "task-0",
        lineageRoot: "task-0",
      };
      expect(task.replayOf).toBe("task-0");
      expect(task.lineageRoot).toBe("task-0");
    });

    it("Task interface accepts all lineage field types", () => {
      const task: Partial<import("../types/task.js").Task> = {
        id: "task-3",
        title: "Escalated task",
        status: "created",
        replayOf: "task-0",
        retriedFrom: "task-1",
        reassignedFrom: "task-2",
        escalatedFrom: "task-3",
        lineageRoot: "task-0",
      };
      expect(task.replayOf).toBe("task-0");
      expect(task.retriedFrom).toBe("task-1");
      expect(task.reassignedFrom).toBe("task-2");
      expect(task.escalatedFrom).toBe("task-3");
      expect(task.lineageRoot).toBe("task-0");
    });

    it("lineageRoot defaults to source taskId when source has no lineageRoot", () => {
      // Simulates the computation in replayTaskHandler
      const originalData = { lineageRoot: undefined };
      const sourceTaskId = "task-original";
      const computedRoot = originalData.lineageRoot || sourceTaskId;
      expect(computedRoot).toBe("task-original");
    });

    it("lineageRoot inherits from source when source already has one", () => {
      const originalData = { lineageRoot: "task-root-ancestor" };
      const sourceTaskId = "task-intermediate";
      const computedRoot = originalData.lineageRoot || sourceTaskId;
      expect(computedRoot).toBe("task-root-ancestor");
    });
  });

  // ─── Story 2: State Transitions ───────────────────────────────────────

  describe("Story 2: State Transitions", () => {
    describe("buildTransition", () => {
      it("creates a transition entry with required fields", () => {
        const entry = buildTransition("created", "active", "basher", "claim");
        expect(entry.fromStatus).toBe("created");
        expect(entry.toStatus).toBe("active");
        expect(entry.actor).toBe("basher");
        expect(entry.action).toBe("claim");
        expect(typeof entry.timestamp).toBe("string");
        // Verify ISO 8601 format
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      });

      it("creates a transition entry without optional action", () => {
        const entry = buildTransition("active", "done", "iso");
        expect(entry.fromStatus).toBe("active");
        expect(entry.toStatus).toBe("done");
        expect(entry.actor).toBe("iso");
        expect(entry.action).toBeUndefined();
      });
    });

    describe("appendTransition", () => {
      it("appends to empty/undefined array", () => {
        const entry = buildTransition("created", "active", "basher", "claim");
        const result = appendTransition(undefined, entry);
        expect(result).toHaveLength(1);
        expect(result[0].fromStatus).toBe("created");
      });

      it("appends to existing array", () => {
        const existing: StateTransition[] = [
          { fromStatus: "created", toStatus: "active", timestamp: new Date().toISOString(), actor: "basher", action: "claim" },
        ];
        const entry = buildTransition("active", "done", "basher", "complete");
        const result = appendTransition(existing, entry);
        expect(result).toHaveLength(2);
        expect(result[1].fromStatus).toBe("active");
        expect(result[1].toStatus).toBe("done");
      });

      it("enforces MAX_TRANSITIONS cap of 50", () => {
        // Create array of 50 entries
        const existing: StateTransition[] = Array.from({ length: 50 }, (_, i) => ({
          fromStatus: "created",
          toStatus: "active",
          timestamp: new Date().toISOString(),
          actor: `actor-${i}`,
        }));

        const entry = buildTransition("active", "done", "overflow-actor", "complete");
        const result = appendTransition(existing, entry);
        expect(result).toHaveLength(50);
        // Oldest entry should be trimmed, newest should be the new one
        expect(result[49].actor).toBe("overflow-actor");
        expect(result[0].actor).toBe("actor-1"); // actor-0 should be trimmed
      });

      it("preserves order: oldest first, newest last", () => {
        const existing: StateTransition[] = [
          { fromStatus: "created", toStatus: "active", timestamp: "2026-01-01T00:00:00.000Z", actor: "a" },
        ];
        const entry: StateTransition = {
          fromStatus: "active",
          toStatus: "done",
          timestamp: "2026-01-02T00:00:00.000Z",
          actor: "b",
          action: "complete",
        };
        const result = appendTransition(existing, entry);
        expect(result[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
        expect(result[1].timestamp).toBe("2026-01-02T00:00:00.000Z");
      });
    });

    describe("Transition action labels", () => {
      const actions = ["claim", "complete", "retry", "abort", "reassign", "escalate", "approve", "replay", "unclaim"];

      it.each(actions)("accepts '%s' as a valid action", (action) => {
        const entry = buildTransition("created", "active", "test-actor", action);
        expect(entry.action).toBe(action);
      });
    });
  });

  // ─── Story 3: Lineage Query ───────────────────────────────────────────

  describe("Story 3: Lineage Query Tool", () => {
    it("returns task not found for missing task", async () => {
      const { getFirestore } = await import("../firebase/client.js");
      const mockGet = jest.fn().mockResolvedValue({ exists: false });
      const mockDoc = jest.fn().mockReturnValue({ get: mockGet });
      (getFirestore as jest.Mock).mockReturnValue({ doc: mockDoc, collection: jest.fn() });

      const { getTaskLineageHandler } = await import("../modules/dispatch/lineage.js");

      const auth = {
        userId: "user-1",
        apiKeyHash: "hash",
        encryptionKey: Buffer.from("key"),
        programId: "basher" as any,
        capabilities: ["dispatch.read"],
        rateLimitTier: "standard",
      };

      const result = await getTaskLineageHandler(auth, { taskId: "nonexistent" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe("Task not found");
    });

    it("returns lineage for a root task with no ancestors", async () => {
      const { getFirestore } = await import("../firebase/client.js");

      const mockTaskData = {
        title: "Root task",
        status: "done",
        target: "basher",
        createdAt: { toDate: () => new Date("2026-01-01T00:00:00Z") },
        completedAt: { toDate: () => new Date("2026-01-01T01:00:00Z") },
        stateTransitions: [
          { fromStatus: "created", toStatus: "active", timestamp: "2026-01-01T00:00:00Z", actor: "basher" },
        ],
      };

      const mockGet = jest.fn().mockResolvedValue({ exists: true, id: "task-root", data: () => mockTaskData });
      const mockDoc = jest.fn().mockReturnValue({ get: mockGet });
      const mockQueryGet = jest.fn().mockResolvedValue({ docs: [] });
      const mockWhere = jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: mockQueryGet }) });
      const mockCollection = jest.fn().mockReturnValue({ where: mockWhere });

      (getFirestore as jest.Mock).mockReturnValue({ doc: mockDoc, collection: mockCollection });

      // Clear module cache to pick up new mock
      jest.resetModules();
      jest.mock("../firebase/client.js", () => ({
        getFirestore: jest.fn().mockReturnValue({ doc: mockDoc, collection: mockCollection }),
        serverTimestamp: jest.fn(),
      }));

      const { getTaskLineageHandler } = await import("../modules/dispatch/lineage.js");

      const auth = {
        userId: "user-1",
        apiKeyHash: "hash",
        encryptionKey: Buffer.from("key"),
        programId: "basher" as any,
        capabilities: ["dispatch.read"],
        rateLimitTier: "standard",
      };

      const result = await getTaskLineageHandler(auth, { taskId: "task-root" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.root).toBe("task-root");
      expect(parsed.ancestors).toHaveLength(0);
      expect(parsed.task.id).toBe("task-root");
      expect(parsed.depth).toBe(0);
    });
  });

  // ─── Story 4: Export Tool ─────────────────────────────────────────────

  describe("Story 4: Export Tool", () => {
    it("validates invalid since date", async () => {
      const { getFirestore } = await import("../firebase/client.js");
      const mockCollection = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({ docs: [] }),
            }),
          }),
        }),
      });
      (getFirestore as jest.Mock).mockReturnValue({ collection: mockCollection });

      jest.resetModules();
      jest.mock("../firebase/client.js", () => ({
        getFirestore: jest.fn().mockReturnValue({ collection: mockCollection }),
        serverTimestamp: jest.fn(),
      }));

      const { exportTasksHandler } = await import("../modules/dispatch/lineage.js");

      const auth = {
        userId: "user-1",
        apiKeyHash: "hash",
        encryptionKey: Buffer.from("key"),
        programId: "basher" as any,
        capabilities: ["dispatch.read"],
        rateLimitTier: "standard",
      };

      const result = await exportTasksHandler(auth, { since: "not-a-date" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Invalid");
    });

    it("exports empty task list", async () => {
      const { getFirestore } = await import("../firebase/client.js");
      const mockCollection = jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ docs: [] }),
          }),
        }),
      });
      (getFirestore as jest.Mock).mockReturnValue({ collection: mockCollection });

      jest.resetModules();
      jest.mock("../firebase/client.js", () => ({
        getFirestore: jest.fn().mockReturnValue({ collection: mockCollection }),
        serverTimestamp: jest.fn(),
      }));

      const { exportTasksHandler } = await import("../modules/dispatch/lineage.js");

      const auth = {
        userId: "user-1",
        apiKeyHash: "hash",
        encryptionKey: Buffer.from("key"),
        programId: "basher" as any,
        capabilities: ["dispatch.read"],
        rateLimitTier: "standard",
      };

      const result = await exportTasksHandler(auth, {});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(0);
      expect(parsed.tasks).toEqual([]);
    });

    it("exports tasks with lineage and transition data", async () => {
      const mockDocs = [
        {
          id: "task-1",
          data: () => ({
            type: "task",
            title: "Task One",
            status: "done",
            source: "iso",
            target: "basher",
            priority: "high",
            action: "interrupt",
            completed_status: "SUCCESS",
            model: "claude-sonnet-4-5-20250929",
            provider: "anthropic",
            result: "Completed successfully",
            createdAt: { toDate: () => new Date("2026-01-01") },
            startedAt: { toDate: () => new Date("2026-01-01T00:01:00Z") },
            completedAt: { toDate: () => new Date("2026-01-01T00:10:00Z") },
            replayOf: null,
            lineageRoot: null,
            stateTransitions: [
              { fromStatus: "created", toStatus: "active", timestamp: "2026-01-01T00:01:00Z", actor: "basher" },
              { fromStatus: "active", toStatus: "done", timestamp: "2026-01-01T00:10:00Z", actor: "basher" },
            ],
            tokens_in: 1000,
            tokens_out: 500,
            cost_usd: 0.015,
            attempt_count: 1,
            retryCount: 0,
          }),
        },
      ];

      const { getFirestore } = await import("../firebase/client.js");
      const mockCollection = jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ docs: mockDocs }),
          }),
        }),
      });
      (getFirestore as jest.Mock).mockReturnValue({ collection: mockCollection });

      jest.resetModules();
      jest.mock("../firebase/client.js", () => ({
        getFirestore: jest.fn().mockReturnValue({ collection: mockCollection }),
        serverTimestamp: jest.fn(),
      }));

      const { exportTasksHandler } = await import("../modules/dispatch/lineage.js");

      const auth = {
        userId: "user-1",
        apiKeyHash: "hash",
        encryptionKey: Buffer.from("key"),
        programId: "basher" as any,
        capabilities: ["dispatch.read"],
        rateLimitTier: "standard",
      };

      const result = await exportTasksHandler(auth, { format: "json", limit: 10 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);

      const task = parsed.tasks[0];
      expect(task.id).toBe("task-1");
      expect(task.stateTransitions).toHaveLength(2);
      expect(task.stateTransitions[0].fromStatus).toBe("created");
      expect(task.stateTransitions[1].toStatus).toBe("done");
      expect(task.tokens_in).toBe(1000);
      expect(task.cost_usd).toBe(0.015);
    });
  });

  // ─── Integration: StateTransition on Task type ─────────────────────────

  describe("StateTransition type integration", () => {
    it("StateTransition interface has required fields", () => {
      const st: StateTransition = {
        fromStatus: "created",
        toStatus: "active",
        timestamp: new Date().toISOString(),
        actor: "basher",
      };
      expect(st.fromStatus).toBeDefined();
      expect(st.toStatus).toBeDefined();
      expect(st.timestamp).toBeDefined();
      expect(st.actor).toBeDefined();
    });

    it("StateTransition accepts optional action field", () => {
      const st: StateTransition = {
        fromStatus: "active",
        toStatus: "done",
        timestamp: new Date().toISOString(),
        actor: "iso",
        action: "complete",
      };
      expect(st.action).toBe("complete");
    });
  });
});
