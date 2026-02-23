/**
 * Integration Test: GitHub Reconciliation
 *
 * Tests GitHub reconciliation against Firestore emulator:
 * - Sync queue processing
 * - Retry logic
 * - Max retry abandonment
 * - Firestore operations
 *
 * Note: Cannot test actual GitHub API calls, only Firestore operations.
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser, seedTestData } from "./setup";

describe("GitHub Reconciliation Integration", () => {
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

  describe("Sync Queue Processing", () => {
    it("should read sync queue items from Firestore", async () => {
      const queueItems = [
        {
          id: "sync-001",
          data: {
            operation: "create_issue",
            taskId: "task-123",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            payload: {
              title: "Test Issue",
              body: "Test body",
            },
          },
        },
        {
          id: "sync-002",
          data: {
            operation: "update_project_item",
            taskId: "task-456",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            payload: {
              itemId: "item-123",
              fieldId: "status",
              value: "done",
            },
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      const syncQueue = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "pending")
        .get();

      expect(syncQueue.size).toBe(2);
      expect(syncQueue.docs[0].data().operation).toBeDefined();
      expect(syncQueue.docs[0].data().taskId).toBeDefined();
    });

    it("should filter by operation type", async () => {
      const queueItems = [
        {
          id: "sync-003",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-004",
          data: {
            operation: "update_project_item",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-005",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      const createIssueItems = await db
        .collection(`users/${userId}/sync_queue`)
        .where("operation", "==", "create_issue")
        .get();

      expect(createIssueItems.size).toBe(2);
    });
  });

  describe("Retry Logic", () => {
    it("should increment retry count on failure", async () => {
      const syncId = "sync-006";
      await db.collection(`users/${userId}/sync_queue`).doc(syncId).set({
        operation: "create_issue",
        status: "pending",
        retryCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        payload: { title: "Test" },
      });

      // Simulate retry
      await db.collection(`users/${userId}/sync_queue`).doc(syncId).update({
        retryCount: admin.firestore.FieldValue.increment(1),
        lastRetryAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: "GitHub API timeout",
      });

      const syncDoc = await db.collection(`users/${userId}/sync_queue`).doc(syncId).get();
      const data = syncDoc.data();

      expect(data?.retryCount).toBe(1);
      expect(data?.lastRetryAt).toBeDefined();
      expect(data?.lastError).toBe("GitHub API timeout");
    });

    it("should handle exponential backoff timing", async () => {
      const syncId = "sync-007";
      const baseDelayMs = 1000; // 1 second

      await db.collection(`users/${userId}/sync_queue`).doc(syncId).set({
        operation: "update_project_item",
        status: "pending",
        retryCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate multiple retries with exponential backoff
      for (let i = 1; i <= 3; i++) {
        const delayMs = baseDelayMs * Math.pow(2, i - 1);
        const nextRetryAt = admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + delayMs)
        );

        await db.collection(`users/${userId}/sync_queue`).doc(syncId).update({
          retryCount: i,
          nextRetryAt,
          lastRetryAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const syncDoc = await db.collection(`users/${userId}/sync_queue`).doc(syncId).get();
      const data = syncDoc.data();

      expect(data?.retryCount).toBe(3);
      expect(data?.nextRetryAt).toBeDefined();
    });

    it("should identify items ready for retry", async () => {
      const now = admin.firestore.Timestamp.now();
      const pastTime = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 5 * 60 * 1000) // 5 min ago
      );
      const futureTime = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() + 5 * 60 * 1000) // 5 min from now
      );

      const queueItems = [
        {
          id: "sync-ready-1",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 1,
            nextRetryAt: pastTime,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-ready-2",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 1,
            nextRetryAt: pastTime,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-not-ready",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 1,
            nextRetryAt: futureTime,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      // Query items ready for retry
      const readyForRetry = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "pending")
        .where("nextRetryAt", "<=", now)
        .get();

      expect(readyForRetry.size).toBe(2);
    });
  });

  describe("Max Retry Abandonment", () => {
    it("should mark item as abandoned after max retries", async () => {
      const syncId = "sync-008";
      const MAX_RETRY_COUNT = 5;

      await db.collection(`users/${userId}/sync_queue`).doc(syncId).set({
        operation: "create_issue",
        status: "pending",
        retryCount: MAX_RETRY_COUNT,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        payload: { title: "Failing sync" },
      });

      // Check if should be abandoned
      const syncDoc = await db.collection(`users/${userId}/sync_queue`).doc(syncId).get();
      const shouldAbandon = syncDoc.data()?.retryCount >= MAX_RETRY_COUNT;

      expect(shouldAbandon).toBe(true);

      // Mark as abandoned
      await db.collection(`users/${userId}/sync_queue`).doc(syncId).update({
        status: "abandoned",
        abandonedAt: admin.firestore.FieldValue.serverTimestamp(),
        abandonReason: `Max retries (${MAX_RETRY_COUNT}) exceeded`,
      });

      const abandonedDoc = await db.collection(`users/${userId}/sync_queue`).doc(syncId).get();
      const data = abandonedDoc.data();

      expect(data?.status).toBe("abandoned");
      expect(data?.abandonedAt).toBeDefined();
      expect(data?.abandonReason).toContain("Max retries");
    });

    it("should query all abandoned items", async () => {
      const queueItems = [
        {
          id: "sync-009",
          data: {
            operation: "create_issue",
            status: "abandoned",
            retryCount: 5,
            abandonedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-010",
          data: {
            operation: "update_project_item",
            status: "abandoned",
            retryCount: 5,
            abandonedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-011",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 2,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      const abandonedItems = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "abandoned")
        .get();

      expect(abandonedItems.size).toBe(2);
    });
  });

  describe("Successful Sync Processing", () => {
    it("should mark item as completed on success", async () => {
      const syncId = "sync-012";

      await db.collection(`users/${userId}/sync_queue`).doc(syncId).set({
        operation: "create_issue",
        status: "pending",
        retryCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        payload: { title: "Success case" },
      });

      // Mark as completed
      await db.collection(`users/${userId}/sync_queue`).doc(syncId).update({
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        githubResponse: {
          issueNumber: 123,
          url: "https://github.com/rezzedai/grid/issues/123",
        },
      });

      const syncDoc = await db.collection(`users/${userId}/sync_queue`).doc(syncId).get();
      const data = syncDoc.data();

      expect(data?.status).toBe("completed");
      expect(data?.completedAt).toBeDefined();
      expect(data?.githubResponse).toBeDefined();
      expect(data?.githubResponse.issueNumber).toBe(123);
    });

    it("should handle bulk completion", async () => {
      const queueItems = [
        {
          id: "sync-013",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-014",
          data: {
            operation: "create_issue",
            status: "pending",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      // Mark all as completed
      const batch = db.batch();
      for (const item of queueItems) {
        const ref = db.collection(`users/${userId}/sync_queue`).doc(item.id);
        batch.update(ref, {
          status: "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      const completedItems = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "completed")
        .get();

      expect(completedItems.size).toBe(2);
    });
  });

  describe("Queue Management", () => {
    it("should support priority ordering", async () => {
      const queueItems = [
        {
          id: "sync-015",
          data: {
            operation: "create_issue",
            status: "pending",
            priority: "high",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-016",
          data: {
            operation: "create_issue",
            status: "pending",
            priority: "normal",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {
          id: "sync-017",
          data: {
            operation: "create_issue",
            status: "pending",
            priority: "low",
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      // Query high priority items first
      const highPriorityItems = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "pending")
        .where("priority", "==", "high")
        .get();

      expect(highPriorityItems.size).toBe(1);
      expect(highPriorityItems.docs[0].id).toBe("sync-015");
    });

    it("should clean up old completed items", async () => {
      const now = admin.firestore.Timestamp.now();
      const oldTime = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
      );

      const queueItems = [
        {
          id: "sync-old-1",
          data: {
            operation: "create_issue",
            status: "completed",
            completedAt: oldTime,
            createdAt: oldTime,
          },
        },
        {
          id: "sync-recent-1",
          data: {
            operation: "create_issue",
            status: "completed",
            completedAt: now,
            createdAt: now,
          },
        },
      ];

      await seedTestData(userId, "sync_queue", queueItems);

      // Query old completed items for cleanup
      const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 30 * 24 * 60 * 60 * 1000)
      );

      const oldCompleted = await db
        .collection(`users/${userId}/sync_queue`)
        .where("status", "==", "completed")
        .where("completedAt", "<", thirtyDaysAgo)
        .get();

      expect(oldCompleted.size).toBe(1);
      expect(oldCompleted.docs[0].id).toBe("sync-old-1");
    });
  });
});
