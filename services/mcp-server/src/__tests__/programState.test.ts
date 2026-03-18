/**
 * Program State Unit Tests — H3
 *
 * Tests all 8 handlers in programState.ts module:
 * - getProgramStateHandler (with auto-decay logic)
 * - updateProgramStateHandler (partial merge + shadow journal)
 * - storeMemoryHandler (upsert single pattern)
 * - recallMemoryHandler (query patterns with filters)
 * - memoryHealthHandler (summary stats)
 * - deleteMemoryHandler (hard delete)
 * - reinforceMemoryHandler (bump timestamp, update confidence)
 * - getContextHistoryHandler (query shadow journal)
 */

import type { AuthContext } from "../auth/authValidator";
import type { ValidProgramId } from "../config/programs";
import {
  getProgramStateHandler,
  updateProgramStateHandler,
  storeMemoryHandler,
  recallMemoryHandler,
  memoryHealthHandler,
  deleteMemoryHandler,
  reinforceMemoryHandler,
  getContextHistoryHandler,
} from "../modules/programState";

// Mock data stores
const mockStateDocs = new Map<string, any>();
const mockHistoryDocs = new Map<string, any[]>();
let mockEmitEventCalls: any[] = [];

// Mock Firestore
const mockDb = {
  doc: jest.fn((path: string) => ({
    get: jest.fn(async () => {
      const exists = mockStateDocs.has(path);
      const data = mockStateDocs.get(path);
      return {
        exists,
        data: () => data,
      };
    }),
    set: jest.fn(async (data: any) => {
      mockStateDocs.set(path, data);
    }),
    update: jest.fn(async (data: any) => {
      const existing = mockStateDocs.get(path) || {};
      mockStateDocs.set(path, { ...existing, ...data });
    }),
  })),
  collection: jest.fn((path: string) => ({
    add: jest.fn(async (data: any) => {
      if (!mockHistoryDocs.has(path)) {
        mockHistoryDocs.set(path, []);
      }
      const entries = mockHistoryDocs.get(path)!;
      const id = `entry-${entries.length + 1}`;
      entries.push({ id, ...data });
      return { id };
    }),
    orderBy: jest.fn((field: string, direction: "asc" | "desc") => ({
      get: jest.fn(async () => {
        const entries = mockHistoryDocs.get(path) || [];
        const sorted = [...entries].sort((a, b) => {
          if (direction === "asc") {
            return new Date(a[field]).getTime() - new Date(b[field]).getTime();
          } else {
            return new Date(b[field]).getTime() - new Date(a[field]).getTime();
          }
        });
        return {
          docs: sorted.map((d) => ({ ref: { delete: jest.fn() }, data: () => d })),
          size: sorted.length,
        };
      }),
      limit: jest.fn((n: number) => ({
        get: jest.fn(async () => {
          const entries = mockHistoryDocs.get(path) || [];
          const sorted = [...entries].sort((a, b) => {
            if (direction === "asc") {
              return new Date(a[field]).getTime() - new Date(b[field]).getTime();
            } else {
              return new Date(b[field]).getTime() - new Date(a[field]).getTime();
            }
          });
          const limited = sorted.slice(0, n);
          return {
            docs: limited.map((d) => ({ id: d.id, data: () => d })),
            size: limited.length,
          };
        }),
      })),
    })),
  })),
  batch: jest.fn(() => ({
    delete: jest.fn(),
    commit: jest.fn(async () => {}),
  })),
};

jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../modules/programRegistry", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("../middleware/gate", () => ({
  verifySource: jest.fn(() => true),
}));

jest.mock("../modules/events", () => ({
  emitEvent: jest.fn((userId: string, event: any) => {
    mockEmitEventCalls.push({ userId, event });
  }),
}));

jest.mock("../config/access-tiers", () => ({
  STATE_READERS: ["orchestrator", "vector", "iso", "auditor", "dispatcher"],
  STATE_WRITERS: ["legacy", "mobile"],
}));

const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "test-key-hash",
  programId: "basher" as ValidProgramId,
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

describe("Program State — H3 Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStateDocs.clear();
    mockHistoryDocs.clear();
    mockEmitEventCalls = [];
  });

  describe("getProgramStateHandler", () => {
    it("returns existing state for own program", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "completed", notes: "Done" },
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Mock Firestore",
            confidence: 0.8,
            evidence: "Works well",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.exists).toBe(true);
      expect(data.state.programId).toBe("basher");
      expect(data.state.learnedPatterns).toHaveLength(1);
    });

    it("returns default state when no persisted state exists", async () => {
      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.exists).toBe(false);
      expect(data.state.programId).toBe("basher");
      expect(data.state.learnedPatterns).toEqual([]);
      expect(data.state.contextSummary.lastTask).toBeNull();
    });

    it("applies context TTL decay on read", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: tenDaysAgo.toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "completed", notes: "Done" },
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.state.contextSummary.lastTask).toBeNull();
      expect(mockDb.doc).toHaveBeenCalled();
    });

    it("does NOT clear context for in-progress tasks", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: tenDaysAgo.toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "in_progress", notes: "Working" },
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.state.contextSummary.lastTask).not.toBeNull();
      expect(data.state.contextSummary.lastTask.outcome).toBe("in_progress");
    });

    it("marks old patterns as stale (pattern max age)", async () => {
      const thirtyFiveDaysAgo = new Date();
      thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

      const recentDate = new Date().toISOString();

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Old pattern 1",
            confidence: 0.8,
            evidence: "Old",
            discoveredAt: thirtyFiveDaysAgo.toISOString(),
            lastReinforced: thirtyFiveDaysAgo.toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "testing",
            pattern: "Old pattern 2",
            confidence: 0.7,
            evidence: "Old",
            discoveredAt: thirtyFiveDaysAgo.toISOString(),
            lastReinforced: thirtyFiveDaysAgo.toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p3",
            domain: "testing",
            pattern: "Recent pattern",
            confidence: 0.9,
            evidence: "Fresh",
            discoveredAt: recentDate,
            lastReinforced: recentDate,
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      const stalePatterns = data.state.learnedPatterns.filter((p: any) => p.stale);
      expect(stalePatterns).toHaveLength(2);
      expect(mockEmitEventCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              event_type: "STATE_DECAY",
              patterns_decayed: 2,
            }),
          }),
        ])
      );
    });

    it("does NOT stale promoted patterns", async () => {
      const thirtyFiveDaysAgo = new Date();
      thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Old promoted pattern",
            confidence: 0.8,
            evidence: "Old but promoted",
            discoveredAt: thirtyFiveDaysAgo.toISOString(),
            lastReinforced: thirtyFiveDaysAgo.toISOString(),
            promotedToStore: true,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.state.learnedPatterns[0].stale).toBe(false);
    });

    it("evicts lowest-confidence unpromoted patterns exceeding cap", async () => {
      const patterns = [];
      for (let i = 0; i < 55; i++) {
        patterns.push({
          id: `p${i}`,
          domain: "testing",
          pattern: `Pattern ${i}`,
          confidence: i / 100, // 0.00 to 0.54
          evidence: "Test",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        });
      }

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: patterns,
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      const activeUnpromoted = data.state.learnedPatterns.filter(
        (p: any) => !p.promotedToStore && !p.stale
      );
      expect(activeUnpromoted.length).toBeLessThanOrEqual(50);
    });

    it("denies cross-program read for unauthorized programs", async () => {
      const unauthorizedAuth = { ...mockAuth, programId: "sark" as ValidProgramId };

      const result = await getProgramStateHandler(unauthorizedAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("Access denied");
    });

    it("allows cross-program read for STATE_READERS", async () => {
      const vectorAuth = { ...mockAuth, programId: "vector" as ValidProgramId };

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await getProgramStateHandler(vectorAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(mockEmitEventCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              event_type: "STATE_CROSS_READ",
              target_program: "basher",
            }),
          }),
        ])
      );
    });

    it("rejects unknown program", async () => {
      const { isProgramRegistered } = require("../modules/programRegistry");
      isProgramRegistered.mockResolvedValueOnce(false);

      const result = await getProgramStateHandler(mockAuth, { programId: "unknown" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown program");
    });
  });

  describe("updateProgramStateHandler", () => {
    it("creates new state when none exists (partial merge)", async () => {
      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "in_progress", notes: "Working" },
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.programId).toBe("basher");
      expect(mockDb.doc).toHaveBeenCalled();
    });

    it("merges contextSummary fields (keeps unmentioned fields)", async () => {
      const existingState = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: ["item1", "item2"],
          handoffNotes: "Previous notes",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", existingState);

      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        contextSummary: {
          lastTask: { taskId: "t2", title: "New Task", outcome: "completed", notes: "Done" },
        },
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(updatedState.contextSummary.lastTask.taskId).toBe("t2");
      expect(updatedState.contextSummary.activeWorkItems).toEqual(["item1", "item2"]);
      expect(updatedState.contextSummary.handoffNotes).toBe("Previous notes");
    });

    it("enforces maxUnpromotedPatterns cap on write", async () => {
      const patterns = [];
      for (let i = 0; i < 48; i++) {
        patterns.push({
          id: `p${i}`,
          domain: "testing",
          pattern: `Pattern ${i}`,
          confidence: i / 100,
          evidence: "Test",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        });
      }

      const existingState = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: patterns,
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", existingState);

      const newPatterns = [];
      for (let i = 48; i < 53; i++) {
        newPatterns.push({
          id: `p${i}`,
          domain: "testing",
          pattern: `Pattern ${i}`,
          confidence: i / 100,
          evidence: "Test",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        });
      }

      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        learnedPatterns: [...patterns, ...newPatterns],
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(updatedState.learnedPatterns.length).toBeLessThanOrEqual(50);
    });

    it("appends to shadow journal when contextSummary provided", async () => {
      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "completed", notes: "Done" },
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(mockDb.collection).toHaveBeenCalledWith(
        expect.stringContaining("/context_history")
      );
    });

    it("enforces shadow journal FIFO cap (50 entries)", async () => {
      const historyPath = "tenants/test-user-123/sessions/_meta/program_state/basher/context_history";

      // Seed 50 existing entries
      const entries = [];
      for (let i = 0; i < 50; i++) {
        entries.push({
          id: `entry-${i}`,
          timestamp: new Date(Date.now() - (50 - i) * 1000).toISOString(),
          contextSummary: {},
          sessionId: "test",
          updatedBy: "basher",
        });
      }
      mockHistoryDocs.set(historyPath, entries);

      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        contextSummary: {
          lastTask: { taskId: "t51", title: "New Task", outcome: "completed", notes: "Done" },
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("writes trace to usage ledger when traceId provided", async () => {
      const result = await updateProgramStateHandler(mockAuth, {
        programId: "basher",
        traceId: "trace-123",
        spanId: "span-1",
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      // Note: In unit tests, the usage ledger write is fire-and-forget, so we just verify no error
    });

    it("denies write for unauthorized program", async () => {
      const unauthorizedAuth = { ...mockAuth, programId: "sark" as ValidProgramId };

      const result = await updateProgramStateHandler(unauthorizedAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("Access denied");
    });

    it("allows admin (legacy) to write any program", async () => {
      const legacyAuth = { ...mockAuth, programId: "legacy" as ValidProgramId };

      const result = await updateProgramStateHandler(legacyAuth, {
        programId: "basher",
        contextSummary: {
          lastTask: { taskId: "t1", title: "Test", outcome: "completed", notes: "Done" },
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
    });
  });

  describe("storeMemoryHandler", () => {
    it("stores new pattern", async () => {
      const result = await storeMemoryHandler(mockAuth, {
        programId: "basher",
        pattern: {
          id: "p1",
          domain: "testing",
          pattern: "Always mock Firestore",
          confidence: 0.8,
          evidence: "Saw it work",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.action).toBe("created");
      expect(data.patternsCount).toBe(1);
    });

    it("upserts existing pattern by ID", async () => {
      const existingState = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Old pattern",
            confidence: 0.5,
            evidence: "Old evidence",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", existingState);

      const result = await storeMemoryHandler(mockAuth, {
        programId: "basher",
        pattern: {
          id: "p1",
          domain: "testing",
          pattern: "Updated pattern",
          confidence: 0.9,
          evidence: "New evidence",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        },
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(data.action).toBe("updated");
      expect(updatedState.learnedPatterns).toHaveLength(1);
      expect(updatedState.learnedPatterns[0].confidence).toBe(0.9);
    });

    it("evicts lowest confidence when cap exceeded", async () => {
      const patterns = [];
      for (let i = 0; i < 50; i++) {
        patterns.push({
          id: `p${i}`,
          domain: "testing",
          pattern: `Pattern ${i}`,
          confidence: (i + 10) / 100, // 0.10 to 0.59
          evidence: "Test",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        });
      }

      const existingState = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: patterns,
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", existingState);

      const result = await storeMemoryHandler(mockAuth, {
        programId: "basher",
        pattern: {
          id: "p51",
          domain: "testing",
          pattern: "High confidence pattern",
          confidence: 0.9,
          evidence: "Excellent",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        },
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(data.patternsCount).toBe(50);
      expect(updatedState.learnedPatterns.find((p: any) => p.id === "p51")).toBeDefined();
    });

    it("denies write for unauthorized program", async () => {
      const unauthorizedAuth = { ...mockAuth, programId: "sark" as ValidProgramId };

      const result = await storeMemoryHandler(unauthorizedAuth, {
        programId: "basher",
        pattern: {
          id: "p1",
          domain: "testing",
          pattern: "Test",
          confidence: 0.8,
          evidence: "Test",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        },
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("Access denied");
    });
  });

  describe("recallMemoryHandler", () => {
    it("returns all active patterns (excludes stale by default)", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Active 1",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "testing",
            pattern: "Active 2",
            confidence: 0.7,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p3",
            domain: "testing",
            pattern: "Active 3",
            confidence: 0.9,
            evidence: "Excellent",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p4",
            domain: "testing",
            pattern: "Stale 1",
            confidence: 0.5,
            evidence: "Old",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: true,
          },
          {
            id: "p5",
            domain: "testing",
            pattern: "Stale 2",
            confidence: 0.4,
            evidence: "Old",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: true,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await recallMemoryHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(3);
      expect(data.patterns.every((p: any) => !p.stale)).toBe(true);
    });

    it("includes stale when includeStale=true", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Active",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "testing",
            pattern: "Stale",
            confidence: 0.5,
            evidence: "Old",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: true,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        includeStale: true,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(2);
    });

    it("filters by domain (exact match)", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Test pattern 1",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "architecture",
            pattern: "Arch pattern",
            confidence: 0.7,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p3",
            domain: "testing",
            pattern: "Test pattern 2",
            confidence: 0.9,
            evidence: "Excellent",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        domain: "testing",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(2);
      expect(data.patterns.every((p: any) => p.domain === "testing")).toBe(true);
    });

    it("filters by projectId (exact match)", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "CacheBash pattern",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
            projectId: "cachebash",
          },
          {
            id: "p2",
            domain: "testing",
            pattern: "Other project pattern",
            confidence: 0.7,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
            projectId: "other",
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        projectId: "cachebash",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(1);
      expect(data.patterns[0].projectId).toBe("cachebash");
    });

    it("searches by query (case-insensitive substring across pattern+evidence+domain)", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Always use Jest",
            confidence: 0.8,
            evidence: "vitest failed",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "architecture",
            pattern: "Use microservices",
            confidence: 0.7,
            evidence: "Scalable",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      // Search by pattern text
      let result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        query: "jest",
      });
      let data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(1);
      expect(data.patterns[0].pattern).toContain("Jest");

      // Search by evidence (case-insensitive)
      result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        query: "VITEST",
      });
      data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(1);
      expect(data.patterns[0].evidence).toContain("vitest");
    });

    it("returns empty for no matches", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Test pattern",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await recallMemoryHandler(mockAuth, {
        programId: "basher",
        query: "nonexistent",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.total).toBe(0);
    });

    it("returns empty array when no state exists", async () => {
      const result = await recallMemoryHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.patterns).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  describe("memoryHealthHandler", () => {
    it("returns correct counts", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          // 6 active patterns
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `active-${i}`,
            domain: "testing",
            pattern: `Active ${i}`,
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          })),
          // 3 stale patterns
          ...Array.from({ length: 3 }, (_, i) => ({
            id: `stale-${i}`,
            domain: "old",
            pattern: `Stale ${i}`,
            confidence: 0.5,
            evidence: "Old",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: true,
          })),
          // 1 promoted pattern
          {
            id: "promoted-1",
            domain: "production",
            pattern: "Promoted pattern",
            confidence: 0.9,
            evidence: "Excellent",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: true,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await memoryHealthHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.health.totalPatterns).toBe(10);
      expect(data.health.activePatterns).toBe(7); // 6 active + 1 promoted
      expect(data.health.stalePatterns).toBe(3);
      expect(data.health.promotedPatterns).toBe(1);
    });

    it("returns unique domains", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Test 1",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "architecture",
            pattern: "Arch 1",
            confidence: 0.7,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p3",
            domain: "testing",
            pattern: "Test 2",
            confidence: 0.9,
            evidence: "Excellent",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p4",
            domain: "performance",
            pattern: "Perf 1",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await memoryHealthHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.health.domains).toHaveLength(3);
      expect(data.health.domains).toContain("testing");
      expect(data.health.domains).toContain("architecture");
      expect(data.health.domains).toContain("performance");
    });

    it("returns default health when no state exists", async () => {
      const result = await memoryHealthHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.exists).toBe(false);
      expect(data.health.totalPatterns).toBe(0);
      expect(data.health.activePatterns).toBe(0);
      expect(data.health.stalePatterns).toBe(0);
      expect(data.health.promotedPatterns).toBe(0);
      expect(data.health.domains).toEqual([]);
    });
  });

  describe("deleteMemoryHandler", () => {
    it("hard deletes pattern by ID", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Pattern 1",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p2",
            domain: "testing",
            pattern: "Pattern 2",
            confidence: 0.7,
            evidence: "Good",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
          {
            id: "p3",
            domain: "testing",
            pattern: "Pattern 3",
            confidence: 0.9,
            evidence: "Excellent",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await deleteMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p2",
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(data.patternsCount).toBe(2);
      expect(updatedState.learnedPatterns.find((p: any) => p.id === "p2")).toBeUndefined();
      expect(updatedState.learnedPatterns.find((p: any) => p.id === "p1")).toBeDefined();
      expect(updatedState.learnedPatterns.find((p: any) => p.id === "p3")).toBeDefined();
    });

    it("returns error for nonexistent pattern", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await deleteMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "nonexistent",
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });

    it("returns error when no state exists", async () => {
      const result = await deleteMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p1",
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("No memory state");
    });
  });

  describe("reinforceMemoryHandler", () => {
    it("bumps lastReinforced timestamp", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Old pattern",
            confidence: 0.8,
            evidence: "Good",
            discoveredAt: oldDate.toISOString(),
            lastReinforced: oldDate.toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await reinforceMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p1",
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      const reinforcedPattern = updatedState.learnedPatterns.find((p: any) => p.id === "p1");
      expect(new Date(reinforcedPattern.lastReinforced).getTime()).toBeGreaterThan(oldDate.getTime());
    });

    it("updates confidence when provided", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Pattern",
            confidence: 0.5,
            evidence: "Medium",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await reinforceMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p1",
        confidence: 0.9,
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(data.confidence).toBe(0.9);
      expect(updatedState.learnedPatterns[0].confidence).toBe(0.9);
    });

    it("updates evidence when provided", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Pattern",
            confidence: 0.8,
            evidence: "Old evidence",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: false,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await reinforceMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p1",
        evidence: "New evidence",
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(updatedState.learnedPatterns[0].evidence).toBe("New evidence");
    });

    it("resets stale flag", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Stale pattern",
            confidence: 0.8,
            evidence: "Old",
            discoveredAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            promotedToStore: false,
            stale: true,
          },
        ],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await reinforceMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "p1",
      });

      const data = JSON.parse(result.content[0].text);
      const updatedState = mockStateDocs.get("tenants/test-user-123/sessions/_meta/program_state/basher");

      expect(data.success).toBe(true);
      expect(updatedState.learnedPatterns[0].stale).toBe(false);
    });

    it("returns error for nonexistent pattern", async () => {
      const stateDoc = {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [],
        config: {
          preferredOutputFormat: null,
          toolPreferences: {},
          knownQuirks: [],
          customSettings: {},
        },
        baselines: {
          avgTaskDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: 0,
          lastSessionDurationMinutes: null,
        },
        decay: {
          contextSummaryTTLDays: 7,
          learnedPatternMaxAge: 30,
          maxUnpromotedPatterns: 50,
          lastDecayRun: new Date().toISOString(),
          decayLog: [],
        },
      };

      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", stateDoc);

      const result = await reinforceMemoryHandler(mockAuth, {
        programId: "basher",
        patternId: "nonexistent",
      });

      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("getContextHistoryHandler", () => {
    it("returns entries newest-first", async () => {
      const historyPath = "tenants/test-user-123/sessions/_meta/program_state/basher/context_history";

      const entries = [];
      for (let i = 0; i < 5; i++) {
        entries.push({
          id: `entry-${i}`,
          timestamp: new Date(Date.now() - (5 - i) * 1000).toISOString(),
          contextSummary: { lastTask: { taskId: `t${i}`, title: `Task ${i}`, outcome: "completed", notes: "" } },
          sessionId: "test",
          updatedBy: "basher",
        });
      }
      mockHistoryDocs.set(historyPath, entries);

      // Seed state doc for program validation
      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: { lastTask: null, activeWorkItems: [], handoffNotes: "", openQuestions: [] },
        learnedPatterns: [],
        config: { preferredOutputFormat: null, toolPreferences: {}, knownQuirks: [], customSettings: {} },
        baselines: { avgTaskDurationMinutes: null, commonFailureModes: [], sessionsCompleted: 0, lastSessionDurationMinutes: null },
        decay: { contextSummaryTTLDays: 7, learnedPatternMaxAge: 30, maxUnpromotedPatterns: 50, lastDecayRun: new Date().toISOString(), decayLog: [] },
      });

      const result = await getContextHistoryHandler(mockAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.count).toBe(5);
      // First entry should be newest (entry-4)
      expect(data.entries[0].id).toBe("entry-4");
    });

    it("respects limit parameter", async () => {
      const historyPath = "tenants/test-user-123/sessions/_meta/program_state/basher/context_history";

      const entries = [];
      for (let i = 0; i < 20; i++) {
        entries.push({
          id: `entry-${i}`,
          timestamp: new Date(Date.now() - (20 - i) * 1000).toISOString(),
          contextSummary: { lastTask: { taskId: `t${i}`, title: `Task ${i}`, outcome: "completed", notes: "" } },
          sessionId: "test",
          updatedBy: "basher",
        });
      }
      mockHistoryDocs.set(historyPath, entries);

      // Seed state doc for program validation
      mockStateDocs.set("tenants/test-user-123/sessions/_meta/program_state/basher", {
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: { lastTask: null, activeWorkItems: [], handoffNotes: "", openQuestions: [] },
        learnedPatterns: [],
        config: { preferredOutputFormat: null, toolPreferences: {}, knownQuirks: [], customSettings: {} },
        baselines: { avgTaskDurationMinutes: null, commonFailureModes: [], sessionsCompleted: 0, lastSessionDurationMinutes: null },
        decay: { contextSummaryTTLDays: 7, learnedPatternMaxAge: 30, maxUnpromotedPatterns: 50, lastDecayRun: new Date().toISOString(), decayLog: [] },
      });

      const result = await getContextHistoryHandler(mockAuth, { programId: "basher", limit: 5 });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.count).toBe(5);
    });

    it("denies unauthorized access", async () => {
      const unauthorizedAuth = { ...mockAuth, programId: "sark" as ValidProgramId };

      const result = await getContextHistoryHandler(unauthorizedAuth, { programId: "basher" });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toContain("Access denied");
    });
  });
});
