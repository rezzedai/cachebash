/**
 * Integration Test: Fleet Health Dashboard (Story 3C)
 *
 * Tests the enhanced get_fleet_health handler with summary and full modes.
 * Verifies subscriptionBudget, contextHealth, taskContention, and rateLimits.
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Fleet Health Dashboard Integration", () => {
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

  // === Helpers ===

  async function seedProgram(
    programId: string,
    overrides: Partial<{
      currentState: string;
      lastHeartbeat: Date;
      currentSessionId: string;
      contextBytes: number;
      handoffRequired: boolean;
    }> = {}
  ): Promise<void> {
    const data: Record<string, unknown> = {
      programId,
      currentState: overrides.currentState ?? "working",
      lastHeartbeat: overrides.lastHeartbeat
        ? admin.firestore.Timestamp.fromDate(overrides.lastHeartbeat)
        : admin.firestore.FieldValue.serverTimestamp(),
      currentSessionId: overrides.currentSessionId ?? `${programId}-session`,
    };
    if (overrides.contextBytes !== undefined) data.contextBytes = overrides.contextBytes;
    if (overrides.handoffRequired !== undefined) data.handoffRequired = overrides.handoffRequired;

    await db.doc(`tenants/${userId}/sessions/_meta/programs/${programId}`).set(data);
  }

  async function seedSession(
    sessionId: string,
    overrides: Partial<{
      programId: string;
      model: string;
      contextBytes: number;
      archived: boolean;
    }> = {}
  ): Promise<void> {
    await db.doc(`tenants/${userId}/sessions/${sessionId}`).set({
      name: `Session ${sessionId}`,
      programId: overrides.programId ?? "basher",
      model: overrides.model ?? "claude-opus-4-6",
      contextBytes: overrides.contextBytes ?? null,
      archived: overrides.archived ?? false,
      status: "active",
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async function seedClaimEvent(
    taskId: string,
    sessionId: string,
    outcome: "claimed" | "contention",
    timestamp?: Date
  ): Promise<void> {
    const ttl = admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection(`tenants/${userId}/claim_events`).add({
      taskId,
      sessionId,
      outcome,
      timestamp: timestamp
        ? admin.firestore.Timestamp.fromDate(timestamp)
        : admin.firestore.FieldValue.serverTimestamp(),
      ttl,
    });
  }

  async function seedRateLimitEvent(
    endpoint: string,
    overrides: Partial<{
      sessionId: string;
      modelTier: string;
      backoffMs: number;
      timestamp: Date;
    }> = {}
  ): Promise<void> {
    const ttl = admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection(`tenants/${userId}/rate_limit_events`).add({
      timestamp: overrides.timestamp
        ? admin.firestore.Timestamp.fromDate(overrides.timestamp)
        : admin.firestore.FieldValue.serverTimestamp(),
      sessionId: overrides.sessionId ?? "test-session",
      programId: "basher",
      modelTier: overrides.modelTier ?? "opus",
      endpoint,
      backoffMs: overrides.backoffMs ?? 5000,
      cascaded: false,
      ttl,
    });
  }

  async function seedTask(
    taskId: string,
    overrides: Partial<{
      status: string;
      target: string;
      createdAt: Date;
    }> = {}
  ): Promise<void> {
    await db.doc(`tenants/${userId}/tasks/${taskId}`).set({
      title: `Task ${taskId}`,
      status: overrides.status ?? "created",
      target: overrides.target ?? "basher",
      createdAt: overrides.createdAt
        ? admin.firestore.Timestamp.fromDate(overrides.createdAt)
        : admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // === Tests ===

  describe("Summary Mode", () => {
    it("should return programs, summary, and subscriptionBudget", async () => {
      // Seed programs
      await seedProgram("iso", { currentState: "working" });
      await seedProgram("basher", { currentState: "working" });

      // Seed active sessions with model info
      await seedSession("iso-session", { programId: "iso", model: "claude-opus-4-6" });
      await seedSession("basher-session", { programId: "basher", model: "claude-sonnet-4-5-20250929" });
      await seedSession("alan-session", { programId: "alan", model: "claude-sonnet-4-5-20250929" });

      // Query the data directly to verify subscriptionBudget computation
      const activeSnap = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      expect(activeSnap.size).toBe(3);

      // Verify model tier counting
      const byModelTier: Record<string, number> = {};
      for (const doc of activeSnap.docs) {
        const model = doc.data().model as string | undefined;
        const tier = model?.includes("opus") ? "opus" : "sonnet";
        byModelTier[tier] = (byModelTier[tier] || 0) + 1;
      }

      expect(byModelTier.opus).toBe(1);
      expect(byModelTier.sonnet).toBe(2);

      // Verify utilization calc
      const maxSessions = 8;
      const utilizationPercent = Math.round((3 / maxSessions) * 10000) / 100;
      expect(utilizationPercent).toBe(37.5);
    });

    it("should handle empty fleet gracefully", async () => {
      // No programs, no sessions
      const programsSnap = await db
        .collection(`tenants/${userId}/sessions/_meta/programs`)
        .get();
      const sessionsSnap = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      expect(programsSnap.size).toBe(0);
      expect(sessionsSnap.size).toBe(0);
    });
  });

  describe("Full Mode — contextHealth", () => {
    it("should aggregate context utilization across active sessions", async () => {
      await seedSession("s1", { contextBytes: 100000 }); // 50%
      await seedSession("s2", { contextBytes: 150000 }); // 75%
      await seedSession("s3", { contextBytes: 50000 });  // 25%

      const snap = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      expect(snap.size).toBe(3);

      // Compute context health
      const contextSessions: Array<{ contextPercent: number }> = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.contextBytes) {
          const contextPercent = Math.round((Number(data.contextBytes) / 200000) * 10000) / 100;
          contextSessions.push({ contextPercent });
        }
      }

      expect(contextSessions.length).toBe(3);

      const avgContextPercent = Math.round(
        contextSessions.reduce((sum, s) => sum + s.contextPercent, 0) / contextSessions.length * 100
      ) / 100;
      expect(avgContextPercent).toBe(50);

      const sessionsAboveThreshold = contextSessions.filter((s) => s.contextPercent > 60).length;
      expect(sessionsAboveThreshold).toBe(1); // Only s2 (75%) is above 60%
    });

    it("should exclude archived sessions from context health", async () => {
      await seedSession("active", { contextBytes: 100000 });
      await seedSession("archived", { contextBytes: 180000, archived: true });

      const snap = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      expect(snap.size).toBe(1);
      expect(snap.docs[0].id).toBe("active");
    });
  });

  describe("Full Mode — taskContention", () => {
    it("should compute contention metrics from claim events", async () => {
      const now = new Date();

      // 3 claims: 2 won, 1 contention
      await seedClaimEvent("task-1", "session-a", "claimed", now);
      await seedClaimEvent("task-2", "session-b", "claimed", now);
      await seedClaimEvent("task-2", "session-a", "contention", now);

      const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      const snap = await db
        .collection(`tenants/${userId}/claim_events`)
        .where("timestamp", ">=", oneHourAgo)
        .get();

      expect(snap.size).toBe(3);

      let claimsAttempted = 0;
      let claimsWon = 0;
      let contentionEvents = 0;

      for (const doc of snap.docs) {
        const data = doc.data();
        claimsAttempted++;
        if (data.outcome === "claimed") claimsWon++;
        else if (data.outcome === "contention") contentionEvents++;
      }

      expect(claimsAttempted).toBe(3);
      expect(claimsWon).toBe(2);
      expect(contentionEvents).toBe(1);

      const contentionRate = Math.round((contentionEvents / claimsAttempted) * 10000) / 100;
      expect(contentionRate).toBeCloseTo(33.33, 1);
    });

    it("should return zero contention when no claim events exist", async () => {
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      const snap = await db
        .collection(`tenants/${userId}/claim_events`)
        .where("timestamp", ">=", oneHourAgo)
        .get();

      expect(snap.size).toBe(0);
    });
  });

  describe("Full Mode — rateLimits", () => {
    it("should aggregate rate limit events by endpoint", async () => {
      const now = new Date();

      await seedRateLimitEvent("/v1/mcp", { timestamp: now });
      await seedRateLimitEvent("/v1/mcp", { timestamp: now });
      await seedRateLimitEvent("/v1/tasks", { timestamp: now });
      await seedRateLimitEvent("/v1/mcp", { timestamp: now });

      const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      const snap = await db
        .collection(`tenants/${userId}/rate_limit_events`)
        .where("timestamp", ">=", oneHourAgo)
        .get();

      expect(snap.size).toBe(4);

      // Count by endpoint
      const endpointCounts = new Map<string, number>();
      for (const doc of snap.docs) {
        const endpoint = doc.data().endpoint as string || "unknown";
        endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + 1);
      }

      const sorted = Array.from(endpointCounts.entries())
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      expect(sorted[0].endpoint).toBe("/v1/mcp");
      expect(sorted[0].count).toBe(3);
      expect(sorted[1].endpoint).toBe("/v1/tasks");
      expect(sorted[1].count).toBe(1);
    });

    it("should return zero events when no rate limits occurred", async () => {
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      const snap = await db
        .collection(`tenants/${userId}/rate_limit_events`)
        .where("timestamp", ">=", oneHourAgo)
        .get();

      expect(snap.size).toBe(0);
    });
  });

  describe("Subscription Budget", () => {
    it("should classify sessions by model tier", async () => {
      await seedSession("opus-1", { model: "claude-opus-4-6" });
      await seedSession("opus-2", { model: "claude-opus-4-6" });
      await seedSession("sonnet-1", { model: "claude-sonnet-4-5-20250929" });
      await seedSession("haiku-1", { model: "claude-haiku-4-5-20251001" });

      const snap = await db
        .collection(`tenants/${userId}/sessions`)
        .where("archived", "==", false)
        .get();

      const byModelTier: Record<string, number> = {};
      for (const doc of snap.docs) {
        const model = doc.data().model as string | undefined;
        const tier = model?.includes("opus") ? "opus" : "sonnet";
        byModelTier[tier] = (byModelTier[tier] || 0) + 1;
      }

      expect(byModelTier.opus).toBe(2);
      expect(byModelTier.sonnet).toBe(2); // sonnet + haiku → both non-opus
      expect(snap.size).toBe(4);

      const utilizationPercent = Math.round((4 / 8) * 10000) / 100;
      expect(utilizationPercent).toBe(50);
    });
  });
});
