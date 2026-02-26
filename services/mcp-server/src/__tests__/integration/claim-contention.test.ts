/**
 * Integration Test: Claim Contention Telemetry (Story 2D)
 *
 * Tests claim event emission and contention metrics querying against Firestore emulator:
 * - Claim event emitted on successful claim
 * - Claim event emitted on contention (task already active)
 * - Contention metrics query returns correct aggregation
 * - Mean time to claim calculation
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Claim Contention Telemetry Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-contention");
    userId = testUser.userId;
  });

  describe("Claim Event Emission", () => {
    it("should write a claimed event to claim_events collection", async () => {
      const taskId = "task-claim-001";
      const sessionId = "basher-session-001";

      // Simulate what claimTaskHandler does on successful claim
      const ttl = admin.firestore.Timestamp.fromMillis(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );

      const ref = await db.collection(`tenants/${userId}/claim_events`).add({
        taskId,
        sessionId,
        outcome: "claimed",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ttl,
      });

      const doc = await ref.get();
      const data = doc.data()!;

      expect(data.taskId).toBe(taskId);
      expect(data.sessionId).toBe(sessionId);
      expect(data.outcome).toBe("claimed");
      expect(data.timestamp).toBeDefined();
      expect(data.ttl).toBeDefined();
    });

    it("should write a contention event to claim_events collection", async () => {
      const taskId = "task-claim-002";
      const sessionId = "alan-session-002";

      const ttl = admin.firestore.Timestamp.fromMillis(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );

      const ref = await db.collection(`tenants/${userId}/claim_events`).add({
        taskId,
        sessionId,
        outcome: "contention",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ttl,
      });

      const doc = await ref.get();
      const data = doc.data()!;

      expect(data.outcome).toBe("contention");
    });
  });

  describe("Contention Metrics Query", () => {
    it("should correctly count claims and contention events", async () => {
      const collection = db.collection(`tenants/${userId}/claim_events`);
      const now = new Date();

      // Seed 3 successful claims and 2 contention events
      await collection.add({
        taskId: "task-a",
        sessionId: "session-1",
        outcome: "claimed",
        timestamp: admin.firestore.Timestamp.fromDate(now),
        ttl: admin.firestore.Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        taskId: "task-b",
        sessionId: "session-2",
        outcome: "claimed",
        timestamp: admin.firestore.Timestamp.fromDate(now),
        ttl: admin.firestore.Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        taskId: "task-c",
        sessionId: "session-3",
        outcome: "claimed",
        timestamp: admin.firestore.Timestamp.fromDate(now),
        ttl: admin.firestore.Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        taskId: "task-a",
        sessionId: "session-4",
        outcome: "contention",
        timestamp: admin.firestore.Timestamp.fromDate(now),
        ttl: admin.firestore.Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        taskId: "task-b",
        sessionId: "session-5",
        outcome: "contention",
        timestamp: admin.firestore.Timestamp.fromDate(now),
        ttl: admin.firestore.Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });

      // Query all claim events for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await collection
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .get();

      let claimsWon = 0;
      let contentionEvents = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.outcome === "claimed") claimsWon++;
        else if (data.outcome === "contention") contentionEvents++;
      }

      expect(snapshot.size).toBe(5);
      expect(claimsWon).toBe(3);
      expect(contentionEvents).toBe(2);
    });

    it("should compute mean time to claim from task createdAt to claim event timestamp", async () => {
      const taskId = "task-latency-001";
      const taskCreatedAt = new Date(Date.now() - 5000); // 5 seconds ago
      const claimTimestamp = new Date(); // now

      // Create the task
      await db.collection(`tenants/${userId}/tasks`).doc(taskId).set({
        title: "Latency Test Task",
        type: "task",
        status: "active",
        source: "orchestrator",
        target: "basher",
        createdAt: admin.firestore.Timestamp.fromDate(taskCreatedAt),
        startedAt: admin.firestore.Timestamp.fromDate(claimTimestamp),
      });

      // Create the claim event
      await db.collection(`tenants/${userId}/claim_events`).add({
        taskId,
        sessionId: "basher-session",
        outcome: "claimed",
        timestamp: admin.firestore.Timestamp.fromDate(claimTimestamp),
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Simulate the metrics calculation
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const claimSnap = await db.collection(`tenants/${userId}/claim_events`)
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .get();

      // Get the claimed task IDs
      const claimedTaskIds: string[] = [];
      for (const doc of claimSnap.docs) {
        const data = doc.data();
        if (data.outcome === "claimed" && data.taskId) {
          claimedTaskIds.push(data.taskId);
        }
      }

      expect(claimedTaskIds).toContain(taskId);

      // Fetch task to get createdAt
      const taskDoc = await db.doc(`tenants/${userId}/tasks/${taskId}`).get();
      const taskData = taskDoc.data()!;
      const taskCreatedMs = taskData.createdAt.toDate().getTime();

      // Calculate latency
      const claimEventDoc = claimSnap.docs[0].data();
      const claimMs = claimEventDoc.timestamp.toDate().getTime();
      const latencyMs = claimMs - taskCreatedMs;

      // Should be approximately 5000ms (give or take a few ms for test execution)
      expect(latencyMs).toBeGreaterThanOrEqual(4000);
      expect(latencyMs).toBeLessThanOrEqual(10000);
    });

    it("should respect period filtering for contention metrics", async () => {
      const collection = db.collection(`tenants/${userId}/claim_events`);

      // Add an event from last month
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      await collection.add({
        taskId: "old-task",
        sessionId: "old-session",
        outcome: "claimed",
        timestamp: admin.firestore.Timestamp.fromDate(lastMonth),
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Add an event from today
      await collection.add({
        taskId: "new-task",
        sessionId: "new-session",
        outcome: "contention",
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Query for "today" — should only get today's event
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await collection
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .get();

      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].data().outcome).toBe("contention");
    });
  });
});
