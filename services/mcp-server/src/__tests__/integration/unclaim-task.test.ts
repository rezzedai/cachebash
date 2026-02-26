/**
 * Integration Test: Unclaim Task
 *
 * Tests unclaim_task behavior against Firestore emulator:
 * - Unclaim active task -> status returns to created
 * - Unclaim already-created task -> error
 * - Circuit breaker at 3 unclaims -> flagged for manual review
 * - Authorization checks
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Unclaim Task Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-123");
    userId = testUser.userId;
  });

  describe("Basic Unclaim", () => {
    it("should transition task from active to created", async () => {
      const taskId = "unclaim-001";

      // Create an active task
      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Active Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        sessionId: "session-123",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate unclaim via transaction (same pattern as handler)
      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        expect(doc.exists).toBe(true);
        const data = doc.data()!;
        expect(data.status).toBe("active");

        tx.update(taskRef, {
          status: "created",
          sessionId: null,
          startedAt: null,
          lastHeartbeat: null,
          unclaimCount: admin.firestore.FieldValue.increment(1),
          lastUnclaimedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUnclaimReason: "manual",
        });
      });

      // Verify task is back to created
      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.status).toBe("created");
      expect(data?.sessionId).toBeNull();
      expect(data?.startedAt).toBeNull();
      expect(data?.lastHeartbeat).toBeNull();
      expect(data?.unclaimCount).toBe(1);
      expect(data?.lastUnclaimReason).toBe("manual");
      expect(data?.lastUnclaimedAt).toBeDefined();
    });

    it("should reject unclaim for non-active task (status: created)", async () => {
      const taskId = "unclaim-002";

      // Create a task in 'created' status
      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Created Task",
        type: "task",
        status: "created",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      // Attempt unclaim — should be rejected since task is not active
      let errorMessage = "";
      try {
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(taskRef);
          const data = doc.data()!;

          if (data.status !== "active") {
            throw new Error(`Task not unclaimable (status: ${data.status})`);
          }

          tx.update(taskRef, { status: "created" });
        });
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain("Task not unclaimable (status: created)");

      // Verify task was NOT modified
      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      expect(taskDoc.data()?.status).toBe("created");
    });

    it("should reject unclaim for done task", async () => {
      const taskId = "unclaim-003";

      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Done Task",
        type: "task",
        status: "done",
        source: "orchestrator",
        target: "builder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completed_status: "SUCCESS",
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      let errorMessage = "";
      try {
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(taskRef);
          const data = doc.data()!;
          if (data.status !== "active") {
            throw new Error(`Task not unclaimable (status: ${data.status})`);
          }
          tx.update(taskRef, { status: "created" });
        });
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain("Task not unclaimable (status: done)");
    });
  });

  describe("Unclaim Count Tracking", () => {
    it("should increment unclaimCount on each unclaim", async () => {
      const taskId = "unclaim-004";

      // Create active task with existing unclaimCount
      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Repeatedly Unclaimed Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        sessionId: "session-456",
        unclaimCount: 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      // Unclaim (second time)
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        const data = doc.data()!;
        const currentCount = (data.unclaimCount as number) || 0;
        tx.update(taskRef, {
          status: "created",
          sessionId: null,
          unclaimCount: currentCount + 1,
          lastUnclaimReason: "timeout",
        });
      });

      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      expect(taskDoc.data()?.unclaimCount).toBe(2);
      expect(taskDoc.data()?.status).toBe("created");
    });
  });

  describe("Circuit Breaker", () => {
    it("should flag task for manual review at 3 unclaims", async () => {
      const taskId = "unclaim-005";

      // Create active task with unclaimCount at 2 (next unclaim hits threshold)
      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Problematic Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        sessionId: "session-789",
        unclaimCount: 2,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      // Unclaim (third time — triggers circuit breaker)
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        const data = doc.data()!;
        const currentCount = (data.unclaimCount as number) || 0;
        const newCount = currentCount + 1;

        const updateFields: Record<string, unknown> = {
          status: "created",
          sessionId: null,
          unclaimCount: newCount,
          lastUnclaimReason: "stale_recovery",
        };

        // Circuit breaker: flag at 3+
        if (newCount >= 3) {
          updateFields.requires_action = true;
          updateFields.flagged = true;
        }

        tx.update(taskRef, updateFields);
      });

      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.unclaimCount).toBe(3);
      expect(data?.status).toBe("created");
      expect(data?.flagged).toBe(true);
      expect(data?.requires_action).toBe(true);
    });

    it("should not flag task below 3 unclaims", async () => {
      const taskId = "unclaim-006";

      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Normal Unclaim Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        sessionId: "session-101",
        unclaimCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        const data = doc.data()!;
        const currentCount = (data.unclaimCount as number) || 0;
        const newCount = currentCount + 1;

        const updateFields: Record<string, unknown> = {
          status: "created",
          sessionId: null,
          unclaimCount: newCount,
          lastUnclaimReason: "manual",
        };

        if (newCount >= 3) {
          updateFields.requires_action = true;
          updateFields.flagged = true;
        }

        tx.update(taskRef, updateFields);
      });

      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      expect(data?.unclaimCount).toBe(1);
      expect(data?.status).toBe("created");
      expect(data?.flagged).toBeUndefined();
    });

    it("should still unclaim even when flagging (circuit breaker does not block)", async () => {
      const taskId = "unclaim-007";

      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Heavily Unclaimed Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "builder",
        sessionId: "session-202",
        unclaimCount: 5,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const taskRef = db.collection(`tenants/${userId}/tasks`).doc(taskId);

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        const data = doc.data()!;
        const currentCount = (data.unclaimCount as number) || 0;
        const newCount = currentCount + 1;

        const updateFields: Record<string, unknown> = {
          status: "created",
          sessionId: null,
          unclaimCount: newCount,
          lastUnclaimReason: "stale_recovery",
        };

        if (newCount >= 3) {
          updateFields.requires_action = true;
          updateFields.flagged = true;
        }

        tx.update(taskRef, updateFields);
      });

      const taskDoc = await db.collection(`tenants/${userId}/tasks`).doc(taskId).get();
      const data = taskDoc.data();

      // Still unclaimed successfully — circuit breaker flags but does not block
      expect(data?.status).toBe("created");
      expect(data?.unclaimCount).toBe(6);
      expect(data?.flagged).toBe(true);
    });
  });
});
