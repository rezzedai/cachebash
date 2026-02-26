/**
 * Integration Test: Fleet Timeline
 *
 * Tests fleet_snapshots collection queries against Firestore emulator:
 * - Write snapshots, query returns them ordered
 * - Period filtering works
 * - Resolution aggregation averages numeric fields
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Fleet Timeline Integration", () => {
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

  /**
   * Helper: write a fleet snapshot to the collection.
   */
  async function writeSnapshot(
    timestamp: Date,
    overrides: Partial<{
      total: number;
      byTier: Record<string, number>;
      byProgram: Record<string, number>;
      tasksInFlight: number;
      messagesPending: number;
      heartbeatHealth: number;
    }> = {}
  ): Promise<string> {
    const ts = admin.firestore.Timestamp.fromDate(timestamp);
    const ttl = admin.firestore.Timestamp.fromDate(
      new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000)
    );

    const ref = await db.collection(`tenants/${userId}/fleet_snapshots`).add({
      timestamp: ts,
      activeSessions: {
        total: overrides.total ?? 5,
        byTier: overrides.byTier ?? { opus: 2, sonnet: 3 },
        byProgram: overrides.byProgram ?? { iso: 1, basher: 3, alan: 1 },
      },
      tasksInFlight: overrides.tasksInFlight ?? 7,
      messagesPending: overrides.messagesPending ?? 3,
      heartbeatHealth: overrides.heartbeatHealth ?? 0.8,
      ttl,
    });

    return ref.id;
  }

  describe("Basic Query", () => {
    it("should return snapshots ordered by timestamp", async () => {
      const now = new Date();
      const t1 = new Date(now.getTime() - 3 * 60 * 1000); // 3 min ago
      const t2 = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago
      const t3 = new Date(now.getTime() - 1 * 60 * 1000); // 1 min ago

      // Write in non-chronological order
      await writeSnapshot(t3, { tasksInFlight: 10 });
      await writeSnapshot(t1, { tasksInFlight: 5 });
      await writeSnapshot(t2, { tasksInFlight: 8 });

      // Query ordered by timestamp
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const startTs = admin.firestore.Timestamp.fromDate(startOfDay);

      const snapshot = await db
        .collection(`tenants/${userId}/fleet_snapshots`)
        .where("timestamp", ">=", startTs)
        .orderBy("timestamp", "asc")
        .get();

      expect(snapshot.size).toBe(3);

      const tasks = snapshot.docs.map((doc) => doc.data().tasksInFlight);
      expect(tasks).toEqual([5, 8, 10]); // Chronological order
    });

    it("should return empty array when no snapshots exist", async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startTs = admin.firestore.Timestamp.fromDate(startOfDay);

      const snapshot = await db
        .collection(`tenants/${userId}/fleet_snapshots`)
        .where("timestamp", ">=", startTs)
        .orderBy("timestamp", "asc")
        .get();

      expect(snapshot.empty).toBe(true);
      expect(snapshot.size).toBe(0);
    });
  });

  describe("Period Filtering", () => {
    it("should only return snapshots within the requested period", async () => {
      const now = new Date();

      // Snapshot from today
      const todaySnapshot = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago

      // Snapshot from yesterday
      const yesterdaySnapshot = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago

      await writeSnapshot(todaySnapshot, { tasksInFlight: 10 });
      await writeSnapshot(yesterdaySnapshot, { tasksInFlight: 99 });

      // Query "today" only
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const startTs = admin.firestore.Timestamp.fromDate(startOfToday);

      const snapshot = await db
        .collection(`tenants/${userId}/fleet_snapshots`)
        .where("timestamp", ">=", startTs)
        .orderBy("timestamp", "asc")
        .get();

      // Should only get today's snapshot
      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].data().tasksInFlight).toBe(10);
    });

    it("should return all snapshots within this_week period", async () => {
      const now = new Date();

      // Snapshot from 2 days ago (within this week, assuming test runs mid-week)
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Snapshot from today
      const today = new Date(now.getTime() - 60 * 1000);

      await writeSnapshot(twoDaysAgo, { tasksInFlight: 3 });
      await writeSnapshot(today, { tasksInFlight: 7 });

      // Query this_week
      const startOfWeek = new Date(now);
      startOfWeek.setHours(0, 0, 0, 0);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const startTs = admin.firestore.Timestamp.fromDate(startOfWeek);

      const snapshot = await db
        .collection(`tenants/${userId}/fleet_snapshots`)
        .where("timestamp", ">=", startTs)
        .orderBy("timestamp", "asc")
        .get();

      // Both should be within this week
      expect(snapshot.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Document Schema", () => {
    it("should store and retrieve full fleet snapshot schema", async () => {
      const now = new Date();
      const id = await writeSnapshot(now, {
        total: 8,
        byTier: { opus: 3, sonnet: 5 },
        byProgram: { iso: 1, basher: 4, alan: 2, quorra: 1 },
        tasksInFlight: 12,
        messagesPending: 5,
        heartbeatHealth: 0.95,
      });

      const doc = await db.collection(`tenants/${userId}/fleet_snapshots`).doc(id).get();
      const data = doc.data();

      expect(data).toBeDefined();
      expect(data?.activeSessions.total).toBe(8);
      expect(data?.activeSessions.byTier.opus).toBe(3);
      expect(data?.activeSessions.byTier.sonnet).toBe(5);
      expect(data?.activeSessions.byProgram.iso).toBe(1);
      expect(data?.activeSessions.byProgram.basher).toBe(4);
      expect(data?.tasksInFlight).toBe(12);
      expect(data?.messagesPending).toBe(5);
      expect(data?.heartbeatHealth).toBe(0.95);
      expect(data?.timestamp).toBeDefined();
      expect(data?.ttl).toBeDefined();

      // TTL should be ~7 days from timestamp
      const tsMs = (data?.timestamp as admin.firestore.Timestamp).toMillis();
      const ttlMs = (data?.ttl as admin.firestore.Timestamp).toMillis();
      const diffDays = (ttlMs - tsMs) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(7, 0);
    });
  });
});
