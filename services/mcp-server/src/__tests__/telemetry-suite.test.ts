/**
 * Telemetry Suite Tests — Enhanced metrics, cost forecast, SLA compliance, program health
 */

import { getOperationalMetricsHandler, getCostForecastHandler, getSlaComplianceHandler, getProgramHealthHandler } from "../modules/metrics.js";
import type { AuthContext } from "../auth/authValidator.js";
import * as admin from "firebase-admin";

// Mock Firestore with chainable query methods
const mockDocs: any[] = [];
const mockQuery = {
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn(() => Promise.resolve({
    docs: mockDocs,
    size: mockDocs.length,
    empty: mockDocs.length === 0,
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => mockQuery),
    doc: jest.fn(() => ({
      get: jest.fn(() => Promise.resolve({ exists: false })),
    })),
  })),
  serverTimestamp: jest.fn(() => new Date()),
}));

describe("Telemetry Suite", () => {
  const mockEncryptionKey = Buffer.from("test-encryption-key-32-bytes-long!!!");

  const adminAuth: AuthContext = {
    userId: "test-user",
    programId: "orchestrator",
    apiKeyHash: "test-hash",
    encryptionKey: mockEncryptionKey,
    capabilities: ["*"],
    rateLimitTier: "standard",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocs.length = 0;
  });

  describe("Enhanced Operational Metrics", () => {
    it("calculates success rate by program from completed tasks", async () => {
      // Seed tasks: 2 succeeded, 1 failed for program A; 3 succeeded for program B
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3600000);

      mockDocs.push(
        // Events (for existing metrics)
        { data: () => ({ event_type: "TASK_CREATED", program_id: "program-a", timestamp: now }) },
        { data: () => ({ event_type: "TASK_SUCCEEDED", program_id: "program-a", timestamp: now }) },

        // Completed tasks (for new metrics)
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "FAILED",
          completedAt: now,
          startedAt: oneHourAgo,
          last_error_class: "TRANSIENT",
        }) },
        { data: () => ({
          status: "done",
          target: "program-b",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-b",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-b",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
      );

      const result = await getOperationalMetricsHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.programHealthScores).toBeDefined();
      expect(data.programHealthScores["program-a"]).toBeDefined();
      expect(data.programHealthScores["program-a"].totalTasks).toBe(3);
      expect(data.programHealthScores["program-a"].failed).toBe(1);
      expect(data.programHealthScores["program-a"].successRate).toBeCloseTo(66.67, 1);
      expect(data.programHealthScores["program-b"].successRate).toBe(100);
    });

    it("calculates error breakdown by class", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3600000);

      mockDocs.push(
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "FAILED",
          last_error_class: "TRANSIENT",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "FAILED",
          last_error_class: "TRANSIENT",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-b",
          completed_status: "FAILED",
          last_error_class: "PERMANENT",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-c",
          completed_status: "FAILED",
          last_error_class: "TIMEOUT",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
      );

      const result = await getOperationalMetricsHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.errorBreakdown).toBeDefined();
      expect(data.errorBreakdown.TRANSIENT).toBe(2);
      expect(data.errorBreakdown.PERMANENT).toBe(1);
      expect(data.errorBreakdown.TIMEOUT).toBe(1);
      expect(data.errorBreakdown.DEPENDENCY).toBe(0);
    });

    it("calculates latency percentiles from task durations", async () => {
      const now = admin.firestore.Timestamp.now();

      // Create tasks with varying durations: 10s, 30s, 60s, 90s, 120s
      const durations = [10, 30, 60, 90, 120];
      for (const durationSeconds of durations) {
        const startTime = admin.firestore.Timestamp.fromMillis(now.toMillis() - durationSeconds * 1000);
        mockDocs.push({
          data: () => ({
            status: "done",
            target: "program-a",
            completed_status: "SUCCESS",
            completedAt: now,
            startedAt: startTime,
          }),
        });
      }

      const result = await getOperationalMetricsHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.latencyPercentiles).toBeDefined();
      expect(data.latencyPercentiles.p50).toBeGreaterThan(0);
      expect(data.latencyPercentiles.p75).toBeGreaterThan(data.latencyPercentiles.p50);
      expect(data.latencyPercentiles.p95).toBeGreaterThan(data.latencyPercentiles.p75);
      expect(data.latencyPercentiles.p99).toBeGreaterThanOrEqual(data.latencyPercentiles.p95);
    });

    it("calculates intervention rate", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3600000);

      mockDocs.push(
        // Task with retry
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          retry: { retryCount: 2 },
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        // Cancelled task
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "CANCELLED",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
        // Normal task
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          completedAt: now,
          startedAt: oneHourAgo,
        }) },
      );

      const result = await getOperationalMetricsHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.interventionRate).toBeDefined();
      expect(data.interventionRate.retried).toBe(1);
      expect(data.interventionRate.cancelled).toBe(1);
      expect(data.interventionRate.total).toBe(2);
      expect(data.interventionRate.rate).toBeCloseTo(66.67, 1);
    });
  });

  describe("Cost Forecast", () => {
    it("calculates daily burn rate and projects monthly cost", async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
      const threeDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(threeDaysAgo);

      // Seed 3 tasks over 3 days with $0.30 total cost
      mockDocs.push(
        { data: () => ({
          status: "done",
          cost_usd: 0.10,
          tokens_in: 1000,
          tokens_out: 500,
          completedAt: threeDaysAgoTimestamp,
        }) },
        { data: () => ({
          status: "done",
          cost_usd: 0.10,
          tokens_in: 1000,
          tokens_out: 500,
          completedAt: threeDaysAgoTimestamp,
        }) },
        { data: () => ({
          status: "done",
          cost_usd: 0.10,
          tokens_in: 1000,
          tokens_out: 500,
          completedAt: nowTimestamp,
        }) },
      );

      const result = await getCostForecastHandler(adminAuth, { period: "this_week", forecastDays: 30 });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.currentSpend).toBe(0.3);
      expect(data.dailyBurnRate).toBeGreaterThan(0);
      expect(data.forecastedMonthlyCost).toBeGreaterThan(0);
      expect(data.tokenBurnRate).toBeDefined();
      expect(data.tokenBurnRate.inputPerDay).toBeGreaterThan(0);
      expect(data.topSpenders).toBeDefined();
    });

    it("identifies top 3 spending programs", async () => {
      const now = admin.firestore.Timestamp.now();

      mockDocs.push(
        { data: () => ({ status: "done", cost_usd: 1.50, target: "program-a", completedAt: now }) },
        { data: () => ({ status: "done", cost_usd: 0.50, target: "program-a", completedAt: now }) },
        { data: () => ({ status: "done", cost_usd: 0.80, target: "program-b", completedAt: now }) },
        { data: () => ({ status: "done", cost_usd: 0.30, target: "program-c", completedAt: now }) },
        { data: () => ({ status: "done", cost_usd: 0.10, target: "program-d", completedAt: now }) },
      );

      const result = await getCostForecastHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.topSpenders).toHaveLength(3);
      expect(data.topSpenders[0].program).toBe("program-a");
      expect(data.topSpenders[0].cost).toBe(2.0);
      expect(data.topSpenders[1].program).toBe("program-b");
      expect(data.topSpenders[2].program).toBe("program-c");
    });
  });

  describe("SLA Compliance", () => {
    it("tracks SLA compliance for different action/priority combinations", async () => {
      const now = new Date();
      const nowTimestamp = admin.firestore.Timestamp.fromDate(now);

      // interrupt-high: 5 min SLA — within SLA
      const t1Created = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 4 * 60 * 1000));
      mockDocs.push({
        data: () => ({
          status: "done",
          action: "interrupt",
          priority: "high",
          createdAt: t1Created,
          completedAt: nowTimestamp,
        }),
      });

      // interrupt-high: 5 min SLA — breached
      const t2Created = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 10 * 60 * 1000));
      mockDocs.push({
        data: () => ({
          status: "done",
          action: "interrupt",
          priority: "high",
          target: "program-a",
          createdAt: t2Created,
          completedAt: nowTimestamp,
        }),
      });

      // queue-normal: 60 min SLA — within SLA
      const t3Created = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 50 * 60 * 1000));
      mockDocs.push({
        data: () => ({
          status: "done",
          action: "queue",
          priority: "normal",
          createdAt: t3Created,
          completedAt: nowTimestamp,
        }),
      });

      const result = await getSlaComplianceHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.totalTasks).toBe(3);
      expect(data.withinSla).toBe(2);
      expect(data.breached).toBe(1);
      expect(data.complianceRate).toBeCloseTo(66.67, 1);
      expect(data.breachesByProgram["program-a"]).toBe(1);
      expect(data.breachesBySlaCategory["interrupt-high"]).toBe(1);
    });

    it("uses default SLA when action/priority not found", async () => {
      const now = new Date();
      const nowTimestamp = admin.firestore.Timestamp.fromDate(now);

      // Unknown action/priority — defaults to 60 min
      const t1Created = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 70 * 60 * 1000));
      mockDocs.push({
        data: () => ({
          status: "done",
          action: "unknown-action",
          priority: "unknown-priority",
          createdAt: t1Created,
          completedAt: nowTimestamp,
        }),
      });

      const result = await getSlaComplianceHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.breached).toBe(1);
    });
  });

  describe("Program Health", () => {
    it("calculates health score from multiple components", async () => {
      const now = new Date();
      const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
      const fiveMinAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 5 * 60 * 1000));

      // Seed tasks for program-a: high success, within SLA, low cost
      mockDocs.push(
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          cost_usd: 0.01,
          createdAt: fiveMinAgo,
          completedAt: nowTimestamp,
          action: "queue",
          priority: "normal",
        }) },
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          cost_usd: 0.01,
          createdAt: fiveMinAgo,
          completedAt: nowTimestamp,
          action: "queue",
          priority: "normal",
        }) },
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          cost_usd: 0.01,
          createdAt: fiveMinAgo,
          completedAt: nowTimestamp,
          action: "queue",
          priority: "normal",
        }) },
      );

      const result = await getProgramHealthHandler(adminAuth, { period: "today", programId: "program-a" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.programs).toHaveLength(1);
      expect(data.programs[0].programId).toBe("program-a");
      expect(data.programs[0].healthScore).toBeGreaterThan(0);
      expect(data.programs[0].components).toBeDefined();
      expect(data.programs[0].components.successRate).toBe(100);
      expect(data.programs[0].components.latencyScore).toBe(100);
      expect(data.programs[0].recommendation).toBeDefined();
    });

    it("generates appropriate recommendations based on health signals", async () => {
      const now = new Date();
      const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
      const oneHourAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 60 * 60 * 1000));

      // Seed tasks with high TRANSIENT error rate
      mockDocs.push(
        { data: () => ({
          status: "done",
          target: "program-unhealthy",
          completed_status: "FAILED",
          last_error_class: "TRANSIENT",
          createdAt: oneHourAgo,
          completedAt: nowTimestamp,
        }) },
        { data: () => ({
          status: "done",
          target: "program-unhealthy",
          completed_status: "FAILED",
          last_error_class: "TRANSIENT",
          createdAt: oneHourAgo,
          completedAt: nowTimestamp,
        }) },
        { data: () => ({
          status: "done",
          target: "program-unhealthy",
          completed_status: "SUCCESS",
          createdAt: oneHourAgo,
          completedAt: nowTimestamp,
        }) },
      );

      const result = await getProgramHealthHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.programs).toHaveLength(1);
      expect(data.programs[0].recommendation).toContain("TRANSIENT");
    });

    it("returns all programs when programId not specified", async () => {
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3600000);

      mockDocs.push(
        { data: () => ({
          status: "done",
          target: "program-a",
          completed_status: "SUCCESS",
          completedAt: now,
          createdAt: oneHourAgo,
        }) },
        { data: () => ({
          status: "done",
          target: "program-b",
          completed_status: "SUCCESS",
          completedAt: now,
          createdAt: oneHourAgo,
        }) },
      );

      const result = await getProgramHealthHandler(adminAuth, { period: "today" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.programs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
