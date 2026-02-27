/**
 * Integration Test: Rate Limit Event Stream (Story 2C)
 *
 * Tests rate limit event logging and querying against Firestore emulator:
 * - Log a rate limit event -> document created with correct fields
 * - Query returns events filtered by period
 * - Query filters by sessionId
 * - TTL field is set to 7 days from creation
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Rate Limit Events Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-ratelimit");
    userId = testUser.userId;
  });

  describe("Log Rate Limit Event", () => {
    it("should create a rate limit event document with correct schema", async () => {
      const now = new Date();
      const ttl = admin.firestore.Timestamp.fromMillis(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      const ref = await db.collection(`tenants/${userId}/rate_limit_events`).add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: "basher-session-001",
        programId: "basher",
        modelTier: "opus",
        endpoint: "/v1/messages",
        backoffMs: 5000,
        cascaded: false,
        ttl,
      });

      const doc = await ref.get();
      const data = doc.data()!;

      expect(data.sessionId).toBe("basher-session-001");
      expect(data.programId).toBe("basher");
      expect(data.modelTier).toBe("opus");
      expect(data.endpoint).toBe("/v1/messages");
      expect(data.backoffMs).toBe(5000);
      expect(data.cascaded).toBe(false);
      expect(data.timestamp).toBeDefined();
      expect(data.ttl).toBeDefined();

      // TTL should be approximately 7 days from now
      const ttlDate = data.ttl.toDate();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(ttlDate.getTime()).toBeGreaterThan(now.getTime() + sevenDaysMs - 60000);
      expect(ttlDate.getTime()).toBeLessThan(now.getTime() + sevenDaysMs + 60000);
    });

    it("should create cascaded rate limit event", async () => {
      const ref = await db.collection(`tenants/${userId}/rate_limit_events`).add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: "alan-session-002",
        programId: "alan",
        modelTier: "sonnet",
        endpoint: "/v1/chat",
        backoffMs: 10000,
        cascaded: true,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const doc = await ref.get();
      const data = doc.data()!;

      expect(data.cascaded).toBe(true);
      expect(data.backoffMs).toBe(10000);
    });
  });

  describe("Query Rate Limit Events", () => {
    it("should return events ordered by timestamp desc", async () => {
      // Seed multiple events with slight time differences
      const collection = db.collection(`tenants/${userId}/rate_limit_events`);

      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 2000)),
        sessionId: "session-a",
        programId: "basher",
        modelTier: "opus",
        endpoint: "/v1/messages",
        backoffMs: 3000,
        cascaded: false,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1000)),
        sessionId: "session-b",
        programId: "alan",
        modelTier: "sonnet",
        endpoint: "/v1/chat",
        backoffMs: 5000,
        cascaded: true,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Query all events for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await collection
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .orderBy("timestamp", "desc")
        .get();

      expect(snapshot.size).toBe(2);

      // Most recent event should be first (session-b)
      const events = snapshot.docs.map((d) => d.data());
      expect(events[0].sessionId).toBe("session-b");
      expect(events[1].sessionId).toBe("session-a");
    });

    it("should filter events by sessionId", async () => {
      const collection = db.collection(`tenants/${userId}/rate_limit_events`);

      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        sessionId: "target-session",
        programId: "basher",
        modelTier: "opus",
        endpoint: "/v1/messages",
        backoffMs: 3000,
        cascaded: false,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        sessionId: "other-session",
        programId: "alan",
        modelTier: "sonnet",
        endpoint: "/v1/chat",
        backoffMs: 5000,
        cascaded: false,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await collection
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .where("sessionId", "==", "target-session")
        .orderBy("timestamp", "desc")
        .get();

      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].data().sessionId).toBe("target-session");
    });

    it("should respect period filtering (exclude old events)", async () => {
      const collection = db.collection(`tenants/${userId}/rate_limit_events`);

      // Add an event from 2 weeks ago
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(twoWeeksAgo),
        sessionId: "old-session",
        programId: "basher",
        modelTier: "opus",
        endpoint: "/v1/messages",
        backoffMs: 1000,
        cascaded: false,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Add an event from today
      await collection.add({
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        sessionId: "new-session",
        programId: "basher",
        modelTier: "opus",
        endpoint: "/v1/messages",
        backoffMs: 2000,
        cascaded: false,
        ttl: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Query for "today" — should only get the recent event
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await collection
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(today))
        .orderBy("timestamp", "desc")
        .get();

      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].data().sessionId).toBe("new-session");
    });
  });
});
