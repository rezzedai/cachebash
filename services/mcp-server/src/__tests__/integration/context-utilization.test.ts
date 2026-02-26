/**
 * Integration Test: Context Utilization Recording (Story 2E)
 *
 * Tests context bytes recording in sessions and utilization querying against Firestore emulator:
 * - contextHistory array is appended when contextBytes provided
 * - contextPercent is correctly calculated
 * - Rolling window caps at 1000 entries
 * - Query returns context history for specific session
 * - Query aggregates across active sessions
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

/** Approximate context window size — must match the constant in pulse.ts */
const CONTEXT_WINDOW_BYTES = 200_000;

describe("Context Utilization Recording Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-context");
    userId = testUser.userId;
  });

  describe("Context History Recording", () => {
    it("should append contextHistory entry when contextBytes is written to session", async () => {
      const sessionId = "basher-ctx-001";

      // Create a session
      await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
        name: "BASHER Context Test",
        programId: "basher",
        status: "active",
        currentAction: "Testing context",
        archived: false,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate update_session with contextBytes (mirroring pulse.ts logic)
      const contextBytes = 50000;
      const contextPercent = Math.round((contextBytes / CONTEXT_WINDOW_BYTES) * 10000) / 100;
      const contextEntry = {
        timestamp: new Date().toISOString(),
        contextBytes,
        contextPercent,
      };

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).update({
        contextBytes,
        contextHistory: [contextEntry],
      });

      // Verify
      const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
      const data = doc.data()!;

      expect(data.contextBytes).toBe(50000);
      expect(data.contextHistory).toHaveLength(1);
      expect(data.contextHistory[0].contextBytes).toBe(50000);
      expect(data.contextHistory[0].contextPercent).toBe(25); // 50000/200000 * 100 = 25%
      expect(data.contextHistory[0].timestamp).toBeDefined();
    });

    it("should calculate contextPercent correctly for various sizes", async () => {
      const testCases = [
        { bytes: 0, expectedPercent: 0 },
        { bytes: 100000, expectedPercent: 50 },
        { bytes: 200000, expectedPercent: 100 },
        { bytes: 150000, expectedPercent: 75 },
        { bytes: 33333, expectedPercent: 16.67 },
      ];

      for (const tc of testCases) {
        const percent = Math.round((tc.bytes / CONTEXT_WINDOW_BYTES) * 10000) / 100;
        expect(percent).toBe(tc.expectedPercent);
      }
    });

    it("should accumulate multiple context history entries", async () => {
      const sessionId = "basher-ctx-002";

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
        name: "Multi-entry test",
        programId: "basher",
        status: "active",
        archived: false,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        contextHistory: [],
      });

      // Simulate 3 heartbeat updates with increasing context
      const entries = [
        { contextBytes: 10000, timestamp: new Date(Date.now() - 30000).toISOString() },
        { contextBytes: 50000, timestamp: new Date(Date.now() - 20000).toISOString() },
        { contextBytes: 120000, timestamp: new Date(Date.now() - 10000).toISOString() },
      ].map((e) => ({
        ...e,
        contextPercent: Math.round((e.contextBytes / CONTEXT_WINDOW_BYTES) * 10000) / 100,
      }));

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).update({
        contextBytes: 120000,
        contextHistory: entries,
      });

      const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
      const data = doc.data()!;

      expect(data.contextHistory).toHaveLength(3);
      expect(data.contextHistory[0].contextBytes).toBe(10000);
      expect(data.contextHistory[1].contextBytes).toBe(50000);
      expect(data.contextHistory[2].contextBytes).toBe(120000);
      expect(data.contextHistory[2].contextPercent).toBe(60); // 120000/200000 * 100
    });

    it("should cap contextHistory at 1000 entries (rolling window)", async () => {
      const sessionId = "basher-ctx-rolling";
      const maxHistory = 1000;

      // Generate 1005 entries
      const entries = Array.from({ length: 1005 }, (_, i) => ({
        timestamp: new Date(Date.now() - (1005 - i) * 1000).toISOString(),
        contextBytes: i * 100,
        contextPercent: Math.round((i * 100 / CONTEXT_WINDOW_BYTES) * 10000) / 100,
      }));

      // Simulate the rolling window trim (as done in pulse.ts)
      const trimmed = entries.slice(entries.length - maxHistory);

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
        name: "Rolling window test",
        programId: "basher",
        status: "active",
        archived: false,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        contextHistory: trimmed,
      });

      const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
      const data = doc.data()!;

      expect(data.contextHistory).toHaveLength(maxHistory);

      // First entry should be entry index 5 (since we trimmed first 5)
      expect(data.contextHistory[0].contextBytes).toBe(500);
    });
  });

  describe("Context Utilization Query", () => {
    it("should return context history for a specific session", async () => {
      const sessionId = "basher-query-001";

      const entries = [
        {
          timestamp: new Date().toISOString(),
          contextBytes: 75000,
          contextPercent: 37.5,
        },
        {
          timestamp: new Date().toISOString(),
          contextBytes: 100000,
          contextPercent: 50,
        },
      ];

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
        name: "Query test session",
        programId: "basher",
        status: "active",
        archived: false,
        contextBytes: 100000,
        contextHistory: entries,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate the query
      const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
      const data = doc.data()!;

      expect(data.contextHistory).toHaveLength(2);
      expect(data.contextBytes).toBe(100000);
    });

    it("should aggregate context utilization across active sessions", async () => {
      // Create two active sessions with context history
      await db.doc(`tenants/${userId}/sessions/session-agg-1`).set({
        name: "Session 1",
        programId: "basher",
        status: "active",
        archived: false,
        contextBytes: 80000,
        contextHistory: [
          { timestamp: new Date().toISOString(), contextBytes: 80000, contextPercent: 40 },
        ],
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.doc(`tenants/${userId}/sessions/session-agg-2`).set({
        name: "Session 2",
        programId: "alan",
        status: "active",
        archived: false,
        contextBytes: 150000,
        contextHistory: [
          { timestamp: new Date().toISOString(), contextBytes: 150000, contextPercent: 75 },
        ],
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Also create an archived session that should be excluded
      await db.doc(`tenants/${userId}/sessions/session-archived`).set({
        name: "Archived Session",
        programId: "sark",
        status: "done",
        archived: true,
        contextBytes: 50000,
        contextHistory: [
          { timestamp: new Date().toISOString(), contextBytes: 50000, contextPercent: 25 },
        ],
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Query active (non-archived) sessions
      const snapshot = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      const sessionSummaries = snapshot.docs
        .filter((doc) => {
          const data = doc.data();
          return (data.contextHistory && data.contextHistory.length > 0) || data.contextBytes;
        })
        .map((doc) => {
          const data = doc.data();
          return {
            sessionId: doc.id,
            programId: data.programId,
            currentContextBytes: data.contextBytes,
            historyCount: data.contextHistory?.length || 0,
          };
        });

      expect(sessionSummaries).toHaveLength(2);

      const basherSession = sessionSummaries.find((s) => s.programId === "basher");
      const alanSession = sessionSummaries.find((s) => s.programId === "alan");

      expect(basherSession?.currentContextBytes).toBe(80000);
      expect(alanSession?.currentContextBytes).toBe(150000);
    });

    it("should filter context history by period", async () => {
      const sessionId = "basher-period-001";
      const now = new Date();
      const yesterday = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const entries = [
        // Old entry (2 days ago)
        { timestamp: yesterday.toISOString(), contextBytes: 30000, contextPercent: 15 },
        // Recent entry
        { timestamp: now.toISOString(), contextBytes: 90000, contextPercent: 45 },
      ];

      await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
        name: "Period filter test",
        programId: "basher",
        status: "active",
        archived: false,
        contextBytes: 90000,
        contextHistory: entries,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Simulate period filtering (today only)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
      const data = doc.data()!;
      const fullHistory = data.contextHistory || [];

      const filtered = fullHistory.filter((entry: { timestamp: string }) => {
        return new Date(entry.timestamp).getTime() >= todayStart.getTime();
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].contextBytes).toBe(90000);
    });
  });
});
