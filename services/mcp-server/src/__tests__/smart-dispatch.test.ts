/**
 * Wave 16: Smart Dispatch Tests
 * Tests target suggestion logic with mocked program stats.
 */

import { suggestTargetHandler } from "../modules/dispatch/suggestion";
import type { AuthContext } from "../auth/authValidator.js";

// Mock dependencies
jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => ({ _methodName: "serverTimestamp" })),
}));

jest.mock("../pulse", () => ({
  isProgramPaused: jest.fn((userId: string, programId: string) => {
    return programId === "paused-program";
  }),
  isProgramQuarantined: jest.fn((userId: string, programId: string) => {
    return programId === "quarantined-program";
  }),
}));

// Mock Firestore
const mockDb = {
  collection: jest.fn(),
  doc: jest.fn(),
};

describe("Wave 16: Smart Dispatch", () => {
  const mockAuth = {
    userId: "test-user",
    programId: "basher",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to parse ToolResult
  function parseResult(result: any): any {
    return JSON.parse(result.content[0].text);
  }

  describe("dispatch_suggest_target", () => {
    it("suggests program with higher success rate (>20% difference)", async () => {
      // Mock program stats: program-a has 90% success, program-b has 60% success
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 9, total: 10, avgDuration: 5000 },
              },
            }),
          },
          {
            id: "program-b",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 6, total: 10, avgDuration: 7000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.ranked_programs).toBeDefined();
      expect(parsed.ranked_programs.length).toBe(2);

      // program-a should be ranked first (90% success)
      expect(parsed.ranked_programs[0].programId).toBe("program-a");
      expect(parsed.ranked_programs[0].success_rate).toBe(90);
      expect(parsed.ranked_programs[0].total_completions).toBe(10);

      // program-b should be ranked second (60% success)
      expect(parsed.ranked_programs[1].programId).toBe("program-b");
      expect(parsed.ranked_programs[1].success_rate).toBe(60);
    });

    it("does not suggest if difference is <20%", async () => {
      // Mock program stats: program-a has 75% success, program-b has 70% success (only 5% diff)
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 15, total: 20, avgDuration: 5000 },
              },
            }),
          },
          {
            id: "program-b",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 14, total: 20, avgDuration: 7000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.ranked_programs).toBeDefined();
      expect(parsed.ranked_programs.length).toBe(2);

      // Both should be returned, ranked by success rate
      expect(parsed.ranked_programs[0].programId).toBe("program-a");
      expect(parsed.ranked_programs[1].programId).toBe("program-b");
    });

    it("does not suggest if sample size <5", async () => {
      // Mock program stats: program-a has 100% success but only 3 completions
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 3, total: 3, avgDuration: 5000 },
              },
            }),
          },
          {
            id: "program-b",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 6, total: 10, avgDuration: 7000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.ranked_programs).toBeDefined();
      // program-a should not be included (sample size < 5)
      expect(parsed.ranked_programs.length).toBe(1);
      expect(parsed.ranked_programs[0].programId).toBe("program-b");
    });

    it("excludes paused programs", async () => {
      // Mock program stats: include a paused program
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 9, total: 10, avgDuration: 5000 },
              },
            }),
          },
          {
            id: "paused-program",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 10, total: 10, avgDuration: 4000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      expect((result as any).success).toBe(true);
      expect((result as any).ranked_programs).toBeDefined();
      // paused-program should be excluded
      expect((result as any).ranked_programs.length).toBe(1);
      expect((result as any).ranked_programs[0].programId).toBe("program-a");
    });

    it("excludes quarantined programs", async () => {
      // Mock program stats: include a quarantined program
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 9, total: 10, avgDuration: 5000 },
              },
            }),
          },
          {
            id: "quarantined-program",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 10, total: 10, avgDuration: 4000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      expect((result as any).success).toBe(true);
      expect((result as any).ranked_programs).toBeDefined();
      // quarantined-program should be excluded
      expect((result as any).ranked_programs.length).toBe(1);
      expect((result as any).ranked_programs[0].programId).toBe("program-a");
    });

    it("returns empty list when no stats available", async () => {
      // Mock empty stats
      const mockStatsSnapshot = {
        empty: true,
        docs: [],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {
        taskType: "task",
      });

      expect((result as any).success).toBe(true);
      expect((result as any).ranked_programs).toEqual([]);
      expect((result as any).message).toContain("No program stats available");
    });

    it("defaults to 'task' type when taskType not specified", async () => {
      const mockStatsSnapshot = {
        empty: false,
        docs: [
          {
            id: "program-a",
            data: () => ({
              taskTypeSuccessRates: {
                task: { success: 9, total: 10, avgDuration: 5000 },
              },
            }),
          },
        ],
      };

      mockDb.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockStatsSnapshot),
      });

      const result = await suggestTargetHandler(mockAuth as any, {});

      expect((result as any).success).toBe(true);
      expect((result as any).task_type).toBe("task");
    });
  });
});
