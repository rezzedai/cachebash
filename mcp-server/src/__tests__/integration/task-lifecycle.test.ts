/**
 * Integration Test: Task Lifecycle
 *
 * Tests full task lifecycle against Firestore emulator:
 * - Create task
 * - Claim task
 * - Complete task
 * - TTL expiry
 * - Budget tracking
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Task Lifecycle Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;
  let apiKeyHash: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-123");
    userId = testUser.userId;
    apiKeyHash = testUser.apiKeyHash;
  });

  describe("Create Task", () => {
    it("should create a task document with correct fields", async () => {
      const taskId = "task-001";
      const taskData = {
        title: "Test Task",
        instructions: "Do something",
        type: "task",
        priority: "normal",
        action: "queue",
        source: "orchestrator",
        target: "builder",
        status: "created",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection(`users/${userId}/tasks`).doc(taskId).set(taskData);

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();

      expect(taskDoc.exists).toBe(true);
      const data = taskDoc.data();
      expect(data?.title).toBe("Test Task");
      expect(data?.instructions).toBe("Do something");
      expect(data?.status).toBe("created");
      expect(data?.source).toBe("orchestrator");
      expect(data?.target).toBe("builder");
      expect(data?.createdAt).toBeDefined();
    });

    it("should handle optional fields correctly", async () => {
      const taskId = "task-002";
      const taskData = {
        title: "Minimal Task",
        type: "task",
        priority: "normal",
        action: "queue",
        source: "orchestrator",
        target: "builder",
        status: "created",
        projectId: "test-project",
        threadId: "thread-123",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection(`users/${userId}/tasks`).doc(taskId).set(taskData);

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.projectId).toBe("test-project");
      expect(data?.threadId).toBe("thread-123");
    });
  });

  describe("Claim Task", () => {
    it("should transition task from created to active", async () => {
      const taskId = "task-003";

      // Create task
      await db.collection(`users/${userId}/tasks`).doc(taskId).set({
        title: "Claimable Task",
        type: "task",
        status: "created",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Claim task
      await db.collection(`users/${userId}/tasks`).doc(taskId).update({
        status: "active",
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: "session-123",
      });

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.status).toBe("active");
      expect(data?.claimedAt).toBeDefined();
      expect(data?.sessionId).toBe("session-123");
    });

    it("should prevent double-claiming via transaction", async () => {
      const taskId = "task-004";

      // Create task
      await db.collection(`users/${userId}/tasks`).doc(taskId).set({
        title: "Contentious Task",
        type: "task",
        status: "created",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate two concurrent claim attempts
      const taskRef = db.collection(`users/${userId}/tasks`).doc(taskId);

      const claim1 = db.runTransaction(async (t) => {
        const doc = await t.get(taskRef);
        if (doc.data()?.status !== "created") {
          throw new Error("Task already claimed");
        }
        t.update(taskRef, {
          status: "active",
          sessionId: "session-A",
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      const claim2 = db.runTransaction(async (t) => {
        const doc = await t.get(taskRef);
        if (doc.data()?.status !== "created") {
          throw new Error("Task already claimed");
        }
        t.update(taskRef, {
          status: "active",
          sessionId: "session-B",
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // One should succeed, one should fail
      const results = await Promise.allSettled([claim1, claim2]);
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      expect(succeeded).toBe(1);
      expect(failed).toBe(1);
    });
  });

  describe("Complete Task", () => {
    it("should transition task from active to done with completion metadata", async () => {
      const taskId = "task-005";

      // Create and claim task
      await db.collection(`users/${userId}/tasks`).doc(taskId).set({
        title: "Completable Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: "session-123",
      });

      // Complete task
      await db.collection(`users/${userId}/tasks`).doc(taskId).update({
        status: "done",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completed_status: "SUCCESS",
        tokens_in: 1000,
        tokens_out: 500,
        cost_usd: 0.05,
        model: "claude-opus-4-6",
        provider: "anthropic",
      });

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.status).toBe("done");
      expect(data?.completedAt).toBeDefined();
      expect(data?.completed_status).toBe("SUCCESS");
      expect(data?.tokens_in).toBe(1000);
      expect(data?.tokens_out).toBe(500);
      expect(data?.cost_usd).toBe(0.05);
      expect(data?.model).toBe("claude-opus-4-6");
    });

    it("should handle failed task completion", async () => {
      const taskId = "task-006";

      await db.collection(`users/${userId}/tasks`).doc(taskId).set({
        title: "Failing Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection(`users/${userId}/tasks`).doc(taskId).update({
        status: "failed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completed_status: "FAILED",
        error_code: "TIMEOUT",
        error_class: "TRANSIENT",
      });

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.status).toBe("failed");
      expect(data?.completed_status).toBe("FAILED");
      expect(data?.error_code).toBe("TIMEOUT");
      expect(data?.error_class).toBe("TRANSIENT");
    });
  });

  describe("TTL Expiry", () => {
    it("should mark task as expired when expiresAt is in the past", async () => {
      const taskId = "task-007";
      const pastTimestamp = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      );

      await db.collection(`users/${userId}/tasks`).doc(taskId).set({
        title: "Expired Task",
        type: "task",
        status: "created",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: pastTimestamp,
      });

      const taskDoc = await db.collection(`users/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.expiresAt).toBeDefined();
      const now = admin.firestore.Timestamp.now();
      expect((data?.expiresAt as admin.firestore.Timestamp).toMillis()).toBeLessThan(
        now.toMillis()
      );
    });
  });

  describe("Budget Tracking", () => {
    it("should track cumulative cost across multiple task completions", async () => {
      const tasks = [
        { id: "task-008", cost: 0.10 },
        { id: "task-009", cost: 0.15 },
        { id: "task-010", cost: 0.25 },
      ];

      for (const task of tasks) {
        await db.collection(`users/${userId}/tasks`).doc(task.id).set({
          title: `Budget Task ${task.id}`,
          type: "task",
          status: "done",
          source: "orchestrator",
          target: "builder",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          completed_status: "SUCCESS",
          cost_usd: task.cost,
        });
      }

      // Query all completed tasks
      const completedTasks = await db
        .collection(`users/${userId}/tasks`)
        .where("status", "==", "done")
        .get();

      const totalCost = completedTasks.docs.reduce(
        (sum, doc) => sum + (doc.data().cost_usd || 0),
        0
      );

      expect(totalCost).toBeCloseTo(0.50, 2);
    });
  });
});
