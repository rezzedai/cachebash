/**
 * Metrics Endpoints Test — Verify capability-gated access
 */

import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler } from "../modules/metrics.js";
import { getFleetHealthHandler } from "../modules/pulse.js";
import type { AuthContext } from "../auth/authValidator.js";

// Mock Firestore with chainable query methods
const mockQuery = {
  where: jest.fn().mockReturnThis(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: jest.fn((): Promise<{ docs: any[]; size: number }> => Promise.resolve({ docs: [], size: 0 })),
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

describe("Metrics Endpoints - Capability Gates", () => {
  const mockEncryptionKey = Buffer.from("test-encryption-key-32-bytes-long!!!");

  const adminAuth: AuthContext = {
    userId: "test-user",
    programId: "orchestrator",
    apiKeyHash: "test-hash",
    encryptionKey: mockEncryptionKey,
    capabilities: ["*"],
    rateLimitTier: "standard",
  };

  const vectorAuth: AuthContext = {
    userId: "test-user",
    programId: "vector",
    apiKeyHash: "test-hash-vector",
    encryptionKey: mockEncryptionKey,
    capabilities: ["fleet.read", "metrics.read", "dispatch.read"],
    rateLimitTier: "standard",
  };

  const restrictedAuth: AuthContext = {
    userId: "test-user",
    programId: "builder",
    apiKeyHash: "test-hash-builder",
    encryptionKey: mockEncryptionKey,
    capabilities: ["dispatch.read", "dispatch.write"],
    rateLimitTier: "standard",
  };

  describe("get_fleet_health", () => {
    it("allows admin access", async () => {
      const result = await getFleetHealthHandler(adminAuth, { detail: "summary" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("allows programs with fleet.read capability", async () => {
      const result = await getFleetHealthHandler(vectorAuth, { detail: "summary" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("rejects programs without fleet.read capability", async () => {
      const result = await getFleetHealthHandler(restrictedAuth, { detail: "summary" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("fleet.read");
    });
  });

  describe("get_fleet_health — subscriptionBudget stale-session exclusion", () => {
    beforeEach(() => {
      mockQuery.get.mockReset();
      mockQuery.get.mockResolvedValue({ docs: [], size: 0 });
    });

    it("excludes stale sessions from activeSessionCount and reports staleSessionsExcluded", async () => {
      const now = Date.now();
      // Fresh session: heartbeat 1 minute ago
      const freshTs = { toDate: () => new Date(now - 1 * 60 * 1000) };
      // Stale session: heartbeat 45 minutes ago (beyond 30min threshold)
      const staleTs = { toDate: () => new Date(now - 45 * 60 * 1000) };

      const freshDoc = {
        id: "fresh-session",
        data: () => ({
          model: "claude-sonnet-4-6",
          lastHeartbeat: freshTs,
          lastUpdate: freshTs,
        }),
      };
      const staleDoc = {
        id: "stale-session",
        data: () => ({
          model: "claude-opus-4-6",
          lastHeartbeat: staleTs,
          lastUpdate: staleTs,
        }),
      };

      // getFleetHealthHandler runs Promise.all([programs, pendingRelay, pendingTasks, sessions])
      // mockQuery.get is called in that order — 4th call returns our session docs
      mockQuery.get
        .mockResolvedValueOnce({ docs: [], size: 0 })   // programs
        .mockResolvedValueOnce({ docs: [], size: 0 })   // pending relay
        .mockResolvedValueOnce({ docs: [], size: 0 })   // pending tasks
        .mockResolvedValueOnce({ docs: [freshDoc, staleDoc], size: 2 }); // sessions

      const result = await getFleetHealthHandler(adminAuth, { detail: "summary" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      // Only the fresh session counts against the budget
      expect(data.subscriptionBudget.activeSessionCount).toBe(1);
      // Stale session is surfaced for diagnosability
      expect(data.subscriptionBudget.staleSessionsExcluded).toBe(1);
      // Model tier counts only fresh sessions
      expect(data.subscriptionBudget.byModelTier.sonnet).toBe(1);
      expect(data.subscriptionBudget.byModelTier.opus).toBeUndefined();
      expect(data.subscriptionBudget.utilizationPercent).toBe(6.25); // 1/16
    });

    it("counts all sessions when all heartbeats are fresh", async () => {
      const now = Date.now();
      const freshTs = { toDate: () => new Date(now - 2 * 60 * 1000) }; // 2 min ago

      const docs = [
        { id: "s1", data: () => ({ model: "claude-opus-4-6", lastHeartbeat: freshTs, lastUpdate: freshTs }) },
        { id: "s2", data: () => ({ model: "claude-sonnet-4-6", lastHeartbeat: freshTs, lastUpdate: freshTs }) },
      ];

      mockQuery.get
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: docs, size: 2 });

      const result = await getFleetHealthHandler(adminAuth, { detail: "summary" });
      const data = JSON.parse(result.content[0].text);

      expect(data.subscriptionBudget.activeSessionCount).toBe(2);
      expect(data.subscriptionBudget.staleSessionsExcluded).toBe(0);
    });

    it("falls back to lastUpdate when lastHeartbeat is absent", async () => {
      const now = Date.now();
      const recentUpdate = { toDate: () => new Date(now - 5 * 60 * 1000) }; // 5 min ago

      const doc = {
        id: "no-hb",
        data: () => ({
          model: "claude-sonnet-4-6",
          lastHeartbeat: null,          // no heartbeat field
          lastUpdate: recentUpdate,     // but lastUpdate is fresh
        }),
      };

      mockQuery.get
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: [], size: 0 })
        .mockResolvedValueOnce({ docs: [doc], size: 1 });

      const result = await getFleetHealthHandler(adminAuth, { detail: "summary" });
      const data = JSON.parse(result.content[0].text);

      // Fresh lastUpdate should count even without lastHeartbeat
      expect(data.subscriptionBudget.activeSessionCount).toBe(1);
      expect(data.subscriptionBudget.staleSessionsExcluded).toBe(0);
    });
  });

  describe("get_comms_metrics", () => {
    it("allows admin access", async () => {
      const result = await getCommsMetricsHandler(adminAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("allows programs with metrics.read capability", async () => {
      const result = await getCommsMetricsHandler(vectorAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("rejects programs without metrics.read capability", async () => {
      const result = await getCommsMetricsHandler(restrictedAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("metrics.read");
    });
  });

  describe("get_operational_metrics", () => {
    it("allows admin access", async () => {
      const result = await getOperationalMetricsHandler(adminAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("allows programs with metrics.read capability", async () => {
      const result = await getOperationalMetricsHandler(vectorAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
    });

    it("rejects programs without metrics.read capability", async () => {
      const result = await getOperationalMetricsHandler(restrictedAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("metrics.read");
    });
  });

  describe("get_cost_summary", () => {
    it("allows admin access", async () => {
      const result = await getCostSummaryHandler(adminAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("total_cost_usd");
    });

    it("allows programs with metrics.read capability", async () => {
      const result = await getCostSummaryHandler(vectorAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("total_cost_usd");
    });

    it("rejects programs without metrics.read capability", async () => {
      const result = await getCostSummaryHandler(restrictedAuth, { period: "today" });
      const text = result.content[0].text;
      const data = JSON.parse(text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("metrics.read");
    });

    it("returns JSON format with expected fields", async () => {
      const result = await getCostSummaryHandler(adminAuth, {
        period: "this_month",
        groupBy: "program",
      });
      const text = result.content[0].text;
      const data = JSON.parse(text);

      expect(data.success).toBe(true);
      expect(data).toHaveProperty("total_tokens_in");
      expect(data).toHaveProperty("total_tokens_out");
      expect(data).toHaveProperty("total_cost_usd");
      expect(data).toHaveProperty("task_count");
      expect(data).toHaveProperty("period");
      expect(data).toHaveProperty("groupBy");
      expect(data).toHaveProperty("breakdown");
      expect(Array.isArray(data.breakdown)).toBe(true);
    });
  });
});
