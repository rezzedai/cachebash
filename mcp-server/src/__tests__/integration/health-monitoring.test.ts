/**
 * Integration Test: Health Monitoring
 *
 * Tests GRIDBOT health monitoring against Firestore emulator:
 * - Health check execution
 * - Indicator thresholds
 * - Alert routing
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser, seedTestData } from "./setup";
import { runHealthCheck } from "../../modules/gridbot-monitor";

describe("Health Monitoring Integration", () => {
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

  describe("Task Failure Rate Indicator", () => {
    it("should report OK status when failure rate is low", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      // Create tasks: 9 success, 1 failure = 10% failure rate (below 20% warning)
      const tasks = [];
      for (let i = 0; i < 9; i++) {
        tasks.push({
          id: `task-success-${i}`,
          data: {
            status: "done",
            completed_status: "SUCCESS",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }
      tasks.push({
        id: "task-failed",
        data: {
          status: "failed",
          completed_status: "FAILED",
          completedAt: now,
          createdAt: oneHourAgo,
        },
      });

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);
      const failureRateIndicator = result.indicators.find(
        (i) => i.name === "task_failure_rate"
      );

      expect(failureRateIndicator?.status).toBe("ok");
      expect(failureRateIndicator?.value).toBeLessThan(0.2);
    });

    it("should report WARNING status when failure rate exceeds threshold", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      // Create tasks: 7 success, 3 failure = 30% failure rate (above 20% warning)
      const tasks = [];
      for (let i = 0; i < 7; i++) {
        tasks.push({
          id: `task-success-${i}`,
          data: {
            status: "done",
            completed_status: "SUCCESS",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }
      for (let i = 0; i < 3; i++) {
        tasks.push({
          id: `task-failed-${i}`,
          data: {
            status: "failed",
            completed_status: "FAILED",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);
      const failureRateIndicator = result.indicators.find(
        (i) => i.name === "task_failure_rate"
      );

      expect(failureRateIndicator?.status).toBe("warning");
      expect(failureRateIndicator?.value).toBeGreaterThanOrEqual(0.2);
      expect(failureRateIndicator?.value).toBeLessThan(0.5);
    });

    it("should report CRITICAL status when failure rate is very high", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      // Create tasks: 4 success, 6 failure = 60% failure rate (above 50% critical)
      const tasks = [];
      for (let i = 0; i < 4; i++) {
        tasks.push({
          id: `task-success-${i}`,
          data: {
            status: "done",
            completed_status: "SUCCESS",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }
      for (let i = 0; i < 6; i++) {
        tasks.push({
          id: `task-failed-${i}`,
          data: {
            status: "failed",
            completed_status: "FAILED",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);
      const failureRateIndicator = result.indicators.find(
        (i) => i.name === "task_failure_rate"
      );

      expect(failureRateIndicator?.status).toBe("critical");
      expect(failureRateIndicator?.value).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe("Stale Task Indicator", () => {
    it("should detect stale tasks older than 30 minutes", async () => {
      const now = admin.firestore.Timestamp.now();
      const thirtyMinAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 35 * 60 * 1000) // 35 min ago
      );
      const recentTime = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 10 * 60 * 1000) // 10 min ago
      );

      const tasks = [
        // Stale tasks (created > 30 min ago, still in created status)
        { id: "stale-1", data: { status: "created", createdAt: thirtyMinAgo } },
        { id: "stale-2", data: { status: "created", createdAt: thirtyMinAgo } },
        { id: "stale-3", data: { status: "created", createdAt: thirtyMinAgo } },
        { id: "stale-4", data: { status: "created", createdAt: thirtyMinAgo } },
        { id: "stale-5", data: { status: "created", createdAt: thirtyMinAgo } },
        { id: "stale-6", data: { status: "created", createdAt: thirtyMinAgo } },
        // Recent tasks (should not count)
        { id: "recent-1", data: { status: "created", createdAt: recentTime } },
        { id: "recent-2", data: { status: "created", createdAt: recentTime } },
      ];

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);
      const staleTaskIndicator = result.indicators.find(
        (i) => i.name === "stale_task_count"
      );

      expect(staleTaskIndicator?.value).toBe(6);
      expect(staleTaskIndicator?.status).toBe("warning"); // 6 > 5 warning threshold
    });
  });

  describe("Relay Queue Depth Indicator", () => {
    it("should monitor pending relay message count", async () => {
      const pendingMessages = [];
      for (let i = 0; i < 25; i++) {
        pendingMessages.push({
          id: `relay-${i}`,
          data: {
            status: "pending",
            source: "orchestrator",
            target: "builder",
            message: `Pending message ${i}`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }

      await seedTestData(userId, "relay", pendingMessages);

      const result = await runHealthCheck(userId, db);
      const relayIndicator = result.indicators.find(
        (i) => i.name === "relay_queue_depth"
      );

      expect(relayIndicator?.value).toBe(25);
      expect(relayIndicator?.status).toBe("warning"); // 25 > 20 warning threshold
    });
  });

  describe("Session Death Indicator", () => {
    it("should count SESSION_DEATH events in last hour", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      const events = [];
      for (let i = 0; i < 4; i++) {
        events.push({
          id: `death-event-${i}`,
          data: {
            event_type: "SESSION_DEATH",
            timestamp: now,
            programId: "builder",
          },
        });
      }

      await seedTestData(userId, "events", events);

      const result = await runHealthCheck(userId, db);
      const deathIndicator = result.indicators.find(
        (i) => i.name === "session_death_count"
      );

      expect(deathIndicator?.value).toBe(4);
      expect(deathIndicator?.status).toBe("warning"); // 4 > 3 warning threshold
    });
  });

  describe("Overall Health Status", () => {
    it("should report overall status as CRITICAL when any indicator is critical", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      // Create critical failure rate (60%)
      const tasks = [];
      for (let i = 0; i < 4; i++) {
        tasks.push({
          id: `task-success-${i}`,
          data: {
            status: "done",
            completed_status: "SUCCESS",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }
      for (let i = 0; i < 6; i++) {
        tasks.push({
          id: `task-failed-${i}`,
          data: {
            status: "failed",
            completed_status: "FAILED",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);

      expect(result.overall_status).toBe("critical");
    });

    it("should report overall status as WARNING when no critical but some warnings", async () => {
      const now = admin.firestore.Timestamp.now();
      const thirtyMinAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 35 * 60 * 1000)
      );

      // Create warning-level stale tasks (6 > 5 threshold)
      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push({
          id: `stale-${i}`,
          data: { status: "created", createdAt: thirtyMinAgo },
        });
      }

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);

      expect(result.overall_status).toBe("warning");
    });

    it("should report overall status as OK when all indicators are healthy", async () => {
      const result = await runHealthCheck(userId, db);

      expect(result.overall_status).toBe("ok");
    });
  });

  describe("Alert Routing", () => {
    it("should include alert routing information in result", async () => {
      const result = await runHealthCheck(userId, db);

      expect(result).toHaveProperty("alerts_sent");
      expect(Array.isArray(result.alerts_sent)).toBe(true);
    });

    it("should generate alerts for critical indicators", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromDate(
        new Date(now.toDate().getTime() - 60 * 60 * 1000)
      );

      // Create critical condition
      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push({
          id: `task-failed-${i}`,
          data: {
            status: "failed",
            completed_status: "FAILED",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }
      for (let i = 0; i < 4; i++) {
        tasks.push({
          id: `task-success-${i}`,
          data: {
            status: "done",
            completed_status: "SUCCESS",
            completedAt: now,
            createdAt: oneHourAgo,
          },
        });
      }

      await seedTestData(userId, "tasks", tasks);

      const result = await runHealthCheck(userId, db);

      // Check if critical alert was attempted
      expect(result.overall_status).toBe("critical");
      const criticalIndicators = result.indicators.filter((i) => i.status === "critical");
      expect(criticalIndicators.length).toBeGreaterThan(0);
    });
  });
});
