/**
 * Metrics Endpoints Test — Verify capability-gated access
 */

import { getCostSummaryHandler, getCommsMetricsHandler, getOperationalMetricsHandler } from "../modules/metrics.js";
import { getFleetHealthHandler } from "../modules/pulse.js";
import type { AuthContext } from "../auth/authValidator.js";

// Mock Firestore with chainable query methods
const mockQuery = {
  where: jest.fn().mockReturnThis(),
  get: jest.fn(() => Promise.resolve({ docs: [], size: 0 })),
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
