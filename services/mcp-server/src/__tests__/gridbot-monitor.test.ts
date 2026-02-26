/**
 * Tests for Health Monitoring Module
 */

import { runHealthCheck, HealthCheckResult } from "../modules/gridbot-monitor";
import * as admin from "firebase-admin";

// Mock Firebase
jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../modules/events", () => ({
  emitEvent: jest.fn(),
}));

const mockDb: any = {
  collection: jest.fn(),
};

const mockCollection = {
  where: jest.fn().mockReturnThis(),
  get: jest.fn(),
  add: jest.fn(),
};

describe("Health Monitor", () => {
  const testUserId = "test-user-123";
  const now = admin.firestore.Timestamp.now();
  const oneHourAgo = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() - 60 * 60 * 1000)
  );
  const thirtyMinAgo = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() - 30 * 60 * 1000)
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockReturnValue(mockCollection);
  });

  it("should return ok status when all indicators are healthy", async () => {
    // Mock empty/healthy responses
    mockCollection.get.mockResolvedValue({ size: 0, docs: [], empty: true });

    const result = await runHealthCheck(testUserId);

    expect(result.overall_status).toBe("ok");
    expect(result.indicators).toHaveLength(7);
    expect(result.alerts_sent).toHaveLength(0);
    expect(result.indicators.every((i) => i.status === "ok")).toBe(true);
  });

  it("should detect task failure rate correctly", async () => {
    const mockTasks = [
      { data: () => ({ completed_status: "FAILED" }) },
      { data: () => ({ completed_status: "SUCCESS" }) },
      { data: () => ({ completed_status: "FAILED" }) },
      { data: () => ({ completed_status: "SUCCESS" }) },
      { data: () => ({ completed_status: "FAILED" }) }, // 3/5 = 60% failure
    ];

    let callCount = 0;
    mockCollection.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Task completions query
        return Promise.resolve({ size: 5, docs: mockTasks });
      }
      return Promise.resolve({ size: 0, docs: [], empty: true });
    });

    const result = await runHealthCheck(testUserId);

    const failureIndicator = result.indicators.find((i) => i.name === "task_failure_rate");
    expect(failureIndicator?.value).toBe(0.6);
    expect(failureIndicator?.status).toBe("critical");
    expect(result.overall_status).toBe("critical");
  });

  it("should detect session deaths correctly", async () => {
    const mockDeathEvents = Array(8).fill({ data: () => ({ event_type: "SESSION_DEATH" }) });

    let callCount = 0;
    mockCollection.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ size: 0, docs: [] }); // tasks
      } else if (callCount === 2) {
        return Promise.resolve({ size: 8, docs: mockDeathEvents }); // session deaths
      }
      return Promise.resolve({ size: 0, docs: [] });
    });

    const result = await runHealthCheck(testUserId);

    const deathIndicator = result.indicators.find((i) => i.name === "session_death_count");
    expect(deathIndicator?.value).toBe(8);
    expect(deathIndicator?.status).toBe("warning");
  });

  it("should detect stale tasks correctly", async () => {
    const mockStaleTasks = Array(12).fill({ data: () => ({ status: "created" }) });

    let callCount = 0;
    mockCollection.get.mockImplementation(() => {
      callCount++;
      if (callCount === 3) {
        // Stale tasks query
        return Promise.resolve({ size: 12, docs: mockStaleTasks });
      }
      return Promise.resolve({ size: 0, docs: [] });
    });

    const result = await runHealthCheck(testUserId);

    const staleIndicator = result.indicators.find((i) => i.name === "stale_task_count");
    expect(staleIndicator?.value).toBe(12);
    expect(staleIndicator?.status).toBe("warning");
  });

  it("should route critical alerts to admin mobile", async () => {
    // Create critical relay queue depth
    const mockPendingRelay = Array(60).fill({ data: () => ({ status: "pending" }) });

    let callCount = 0;
    mockCollection.get.mockImplementation(() => {
      callCount++;
      if (callCount === 4) {
        // Relay queue depth query
        return Promise.resolve({ size: 60, docs: mockPendingRelay });
      }
      return Promise.resolve({ size: 0, docs: [] });
    });

    mockCollection.add.mockResolvedValue({ id: "mock-alert-id" });

    const result = await runHealthCheck(testUserId);

    expect(result.overall_status).toBe("critical");
    expect(result.alerts_sent).toContain("HEALTH_CRITICAL alert to admin (mobile)");
    
    // Verify alert was written to relay and tasks
    expect(mockCollection.add).toHaveBeenCalledTimes(3); // relay + tasks + health_checks
  });

  it("should route warning alerts to orchestrator", async () => {
    // Create warning-level wake failures
    const mockWakeEvents = [
      { data: () => ({ event_type: "PROGRAM_WAKE", wake_result: "failed" }) },
      { data: () => ({ event_type: "PROGRAM_WAKE", wake_result: "failed" }) },
      { data: () => ({ event_type: "PROGRAM_WAKE", wake_result: "failed" }) },
    ];

    let callCount = 0;
    mockCollection.get.mockImplementation(() => {
      callCount++;
      if (callCount === 5) {
        // Wake events query
        return Promise.resolve({ size: 3, docs: mockWakeEvents });
      }
      return Promise.resolve({ size: 0, docs: [] });
    });

    mockCollection.add.mockResolvedValue({ id: "mock-warning-id" });

    const result = await runHealthCheck(testUserId);

    expect(result.overall_status).toBe("warning");
    expect(result.alerts_sent).toContain("HEALTH_WARNING status to orchestrator");

    // Verify warning was written to relay
    expect(mockCollection.add).toHaveBeenCalled();
  });

  it("should write health check results to Firestore", async () => {
    mockCollection.get.mockResolvedValue({ size: 0, docs: [], empty: true });
    mockCollection.add.mockResolvedValue({ id: "mock-health-check-id" });

    const result = await runHealthCheck(testUserId);

    expect(mockCollection.add).toHaveBeenCalled();
    const addCall = mockCollection.add.mock.calls.find((call: any) => 
      call[0].timestamp && call[0].overall_status
    );
    expect(addCall).toBeDefined();
  });

  it("should calculate all threshold levels correctly", async () => {
    mockCollection.get.mockResolvedValue({ size: 0, docs: [] });

    const result = await runHealthCheck(testUserId);

    // Verify all 7 indicators exist with proper structure
    expect(result.indicators).toHaveLength(7);
    const indicatorNames = result.indicators.map((i) => i.name);
    expect(indicatorNames).toContain("task_failure_rate");
    expect(indicatorNames).toContain("session_death_count");
    expect(indicatorNames).toContain("stale_task_count");
    expect(indicatorNames).toContain("relay_queue_depth");
    expect(indicatorNames).toContain("wake_failure_count");
    expect(indicatorNames).toContain("cleanup_backlog");
    expect(indicatorNames).toContain("stale_sessions");

    // All indicators should have threshold structure
    result.indicators.forEach((indicator) => {
      expect(indicator.threshold).toHaveProperty("warning");
      expect(indicator.threshold).toHaveProperty("critical");
      expect(["ok", "warning", "critical"]).toContain(indicator.status);
    });
  });
});
