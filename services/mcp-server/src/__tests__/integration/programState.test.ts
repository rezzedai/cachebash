/**
 * Program State Integration Tests — H3
 *
 * Tests full memory lifecycle, shadow journal FIFO, and cross-program access control
 * against Firestore emulator.
 */

import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";
import {
  getProgramStateHandler,
  updateProgramStateHandler,
  storeMemoryHandler,
  recallMemoryHandler,
  reinforceMemoryHandler,
  deleteMemoryHandler,
  getContextHistoryHandler,
} from "../../modules/programState";
import type { AuthContext } from "../../auth/authValidator";
import type { ValidProgramId } from "../../config/programs";

let db: FirebaseFirestore.Firestore;
let testUser: Awaited<ReturnType<typeof seedTestUser>>;
let auth: AuthContext;

// Mock access-tiers for integration tests
jest.mock("../../config/access-tiers", () => ({
  STATE_READERS: ["orchestrator", "vector", "iso", "auditor", "dispatcher"],
  STATE_WRITERS: ["legacy", "mobile"],
  ADMIN_READERS: ["admin", "legacy", "mobile", "orchestrator", "vector", "iso"],
}));

// Mock events module to prevent telemetry writes
jest.mock("../../modules/events", () => ({
  emitEvent: jest.fn(),
}));

beforeAll(() => {
  db = getTestFirestore();
});

beforeEach(async () => {
  await clearFirestoreData();
  testUser = await seedTestUser("integ-state-user");

  // Register basher program
  await db.doc(`tenants/${testUser.userId}/programs/basher`).set({
    programId: "basher",
    displayName: "Basher",
    role: "builder",
    groups: ["builders"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });

  // Register vector program for cross-access tests
  await db.doc(`tenants/${testUser.userId}/programs/vector`).set({
    programId: "vector",
    displayName: "Vector",
    role: "builder",
    groups: ["builders"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });

  // Register sark program for unauthorized access tests
  await db.doc(`tenants/${testUser.userId}/programs/sark`).set({
    programId: "sark",
    displayName: "Sark",
    role: "builder",
    groups: ["builders"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });

  auth = {
    userId: testUser.userId,
    apiKeyHash: testUser.apiKeyHash,
    programId: "basher" as ValidProgramId,
    encryptionKey: testUser.encryptionKey,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
});

describe("Program State Integration Tests — H3", () => {
  describe("Full memory lifecycle", () => {
    it("store → recall → reinforce → verify decay → delete", async () => {
      // 1. Store pattern
      const storeResult = await storeMemoryHandler(auth, {
        programId: "basher",
        pattern: {
          id: "test-pattern",
          domain: "testing",
          pattern: "Mock all deps",
          confidence: 0.6,
          evidence: "Works consistently",
          discoveredAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
          promotedToStore: false,
          stale: false,
        },
      });

      const storeData = JSON.parse(storeResult.content[0].text);
      expect(storeData.success).toBe(true);
      expect(storeData.action).toBe("created");

      // 2. Recall — verify pattern exists
      const recallResult1 = await recallMemoryHandler(auth, { programId: "basher" });
      const recallData1 = JSON.parse(recallResult1.content[0].text);
      expect(recallData1.success).toBe(true);
      expect(recallData1.total).toBe(1);
      expect(recallData1.patterns[0].id).toBe("test-pattern");

      // 3. Reinforce with updated confidence
      const reinforceResult = await reinforceMemoryHandler(auth, {
        programId: "basher",
        patternId: "test-pattern",
        confidence: 0.9,
      });

      const reinforceData = JSON.parse(reinforceResult.content[0].text);
      expect(reinforceData.success).toBe(true);
      expect(reinforceData.confidence).toBe(0.9);

      // 4. Recall again — verify confidence updated
      const recallResult2 = await recallMemoryHandler(auth, { programId: "basher" });
      const recallData2 = JSON.parse(recallResult2.content[0].text);
      expect(recallData2.success).toBe(true);
      expect(recallData2.patterns[0].confidence).toBe(0.9);
      expect(new Date(recallData2.patterns[0].lastReinforced).getTime()).toBeGreaterThan(
        new Date(recallData1.patterns[0].lastReinforced).getTime()
      );

      // 5. Delete pattern
      const deleteResult = await deleteMemoryHandler(auth, {
        programId: "basher",
        patternId: "test-pattern",
      });

      const deleteData = JSON.parse(deleteResult.content[0].text);
      expect(deleteData.success).toBe(true);

      // 6. Recall — verify pattern deleted
      const recallResult3 = await recallMemoryHandler(auth, { programId: "basher" });
      const recallData3 = JSON.parse(recallResult3.content[0].text);
      expect(recallData3.success).toBe(true);
      expect(recallData3.total).toBe(0);
    });
  });

  describe("Shadow journal FIFO", () => {
    it("write 55 entries → verify oldest 5 deleted", async () => {
      // Write 55 context updates
      for (let i = 0; i < 55; i++) {
        await updateProgramStateHandler(auth, {
          programId: "basher",
          contextSummary: {
            lastTask: {
              taskId: `task-${i}`,
              title: `Task ${i}`,
              outcome: "completed",
              notes: `Entry ${i}`,
            },
          },
        });

        // Small delay to ensure distinct timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Query context_history directly via Firestore
      const historyRef = db.collection(
        `tenants/${testUser.userId}/sessions/_meta/program_state/basher/context_history`
      );
      const snapshot = await historyRef.orderBy("timestamp", "asc").get();

      // Should have exactly 50 entries (FIFO cap enforced)
      expect(snapshot.size).toBe(50);

      // Verify the oldest 5 are gone by checking the first entry's task ID
      // The first entry should now be task-5 (since task-0 to task-4 were deleted)
      const entries = snapshot.docs.map((doc) => doc.data());
      const firstEntry = entries[0];

      // The first entry should be from the 6th write (task-5) or later
      const firstTaskNum = parseInt(firstEntry.contextSummary.lastTask.taskId.split("-")[1]);
      expect(firstTaskNum).toBeGreaterThanOrEqual(5);

      // Last entry should be task-54 (the most recent)
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.contextSummary.lastTask.taskId).toBe("task-54");
    });
  });

  describe("Cross-program access control", () => {
    it("read access control + audit event", async () => {
      // Seed state for basher
      await db.doc(`tenants/${testUser.userId}/sessions/_meta/program_state/basher`).set({
        programId: "basher",
        version: 1,
        lastUpdatedBy: "basher",
        lastUpdatedAt: new Date().toISOString(),
        sessionId: "test-session",
        contextSummary: {
          lastTask: {
            taskId: "t1",
            title: "Test Task",
            outcome: "completed",
            notes: "Done",
          },
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        },
        learnedPatterns: [
          {
            id: "p1",
            domain: "testing",
            pattern: "Basher's pattern",
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
      });

      // Test 1: Vector (STATE_READER) can read basher's state
      const vectorAuth: AuthContext = {
        ...auth,
        programId: "vector" as ValidProgramId,
      };

      const vectorReadResult = await getProgramStateHandler(vectorAuth, {
        programId: "basher",
      });
      const vectorReadData = JSON.parse(vectorReadResult.content[0].text);

      expect(vectorReadData.success).toBe(true);
      expect(vectorReadData.state.programId).toBe("basher");
      expect(vectorReadData.state.learnedPatterns).toHaveLength(1);

      // Test 2: Sark (unauthorized) cannot read basher's state
      const sarkAuth: AuthContext = {
        ...auth,
        programId: "sark" as ValidProgramId,
      };

      const sarkReadResult = await getProgramStateHandler(sarkAuth, {
        programId: "basher",
      });
      const sarkReadData = JSON.parse(sarkReadResult.content[0].text);

      expect(sarkReadData.success).toBe(false);
      expect(sarkReadData.error).toContain("Access denied");

      // Verify emitEvent was called for cross-program read
      const { emitEvent } = require("../../modules/events");
      expect(emitEvent).toHaveBeenCalledWith(
        testUser.userId,
        expect.objectContaining({
          event_type: "STATE_CROSS_READ",
          program_id: "vector",
          target_program: "basher",
        })
      );
    });
  });
});
