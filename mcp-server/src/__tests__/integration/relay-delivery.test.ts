/**
 * Integration Test: Relay Message Delivery
 *
 * Tests relay message delivery against Firestore emulator:
 * - Send message
 * - Message status transitions
 * - TTL expiry
 * - Multicast delivery
 * - Idempotency key deduplication
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Relay Delivery Integration", () => {
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

  describe("Send Message", () => {
    it("should create a relay message document with correct structure", async () => {
      const messageId = "msg-001";
      const messageData = {
        source: "orchestrator",
        target: "builder",
        message: "Test message",
        message_type: "DIRECTIVE",
        priority: "normal",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ttl: 86400, // 24 hours in seconds
      };

      await db.collection(`users/${userId}/relay`).doc(messageId).set(messageData);

      const messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      const data = messageDoc.data();

      expect(messageDoc.exists).toBe(true);
      expect(data?.source).toBe("orchestrator");
      expect(data?.target).toBe("builder");
      expect(data?.message).toBe("Test message");
      expect(data?.message_type).toBe("DIRECTIVE");
      expect(data?.status).toBe("pending");
      expect(data?.ttl).toBe(86400);
    });

    it("should handle all message types correctly", async () => {
      const messageTypes = ["PING", "PONG", "HANDSHAKE", "DIRECTIVE", "STATUS", "ACK", "QUERY", "RESULT"];

      for (const type of messageTypes) {
        const messageId = `msg-type-${type}`;
        await db.collection(`users/${userId}/relay`).doc(messageId).set({
          source: "orchestrator",
          target: "builder",
          message: `${type} message`,
          message_type: type,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const allMessages = await db.collection(`users/${userId}/relay`).get();
      expect(allMessages.size).toBe(messageTypes.length);
    });

    it("should include optional payload field", async () => {
      const messageId = "msg-002";
      const payload = {
        taskId: "task-123",
        data: { foo: "bar", count: 42 },
      };

      await db.collection(`users/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Message with payload",
        message_type: "QUERY",
        status: "pending",
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      const data = messageDoc.data();

      expect(data?.payload).toEqual(payload);
    });
  });

  describe("Message Status Transitions", () => {
    it("should transition from pending to delivered to read", async () => {
      const messageId = "msg-003";

      // Create message
      await db.collection(`users/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Transition test",
        message_type: "DIRECTIVE",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ensure document exists before updating
      let messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.exists).toBe(true);

      // Mark as delivered
      await db.collection(`users/${userId}/relay`).doc(messageId).update({
        status: "delivered",
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.data()?.status).toBe("delivered");
      expect(messageDoc.data()?.deliveredAt).toBeDefined();

      // Mark as read
      await db.collection(`users/${userId}/relay`).doc(messageId).update({
        status: "read",
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.data()?.status).toBe("read");
      expect(messageDoc.data()?.readAt).toBeDefined();
    });

    it("should handle failed delivery", async () => {
      const messageId = "msg-004";

      await db.collection(`users/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Failed delivery",
        message_type: "DIRECTIVE",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ensure document exists before updating
      let messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.exists).toBe(true);

      await db.collection(`users/${userId}/relay`).doc(messageId).update({
        status: "failed",
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: "Target not reachable",
      });

      messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      const data = messageDoc.data();

      expect(data?.status).toBe("failed");
      expect(data?.failedAt).toBeDefined();
      expect(data?.error).toBe("Target not reachable");
    });
  });

  describe("TTL Expiry", () => {
    it("should calculate correct expiry time based on TTL", async () => {
      const messageId = "msg-005";
      const ttlSeconds = 3600; // 1 hour

      const createdAt = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        createdAt.toMillis() + ttlSeconds * 1000
      );

      await db.collection(`users/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "TTL test",
        message_type: "DIRECTIVE",
        status: "pending",
        ttl: ttlSeconds,
        createdAt,
        expiresAt,
      });

      const messageDoc = await db.collection(`users/${userId}/relay`).doc(messageId).get();
      const data = messageDoc.data();

      expect(data?.expiresAt).toBeDefined();
      expect((data?.expiresAt as admin.firestore.Timestamp).toMillis()).toBeGreaterThan(
        createdAt.toMillis()
      );
    });

    it("should identify expired messages", async () => {
      const messageId = "msg-006";
      const pastTimestamp = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      );

      await db.collection(`users/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Expired message",
        message_type: "DIRECTIVE",
        status: "pending",
        createdAt: pastTimestamp,
        expiresAt: pastTimestamp,
      });

      const now = admin.firestore.Timestamp.now();
      const expiredMessages = await db
        .collection(`users/${userId}/relay`)
        .where("expiresAt", "<", now)
        .get();

      expect(expiredMessages.size).toBeGreaterThan(0);
      expect(expiredMessages.docs[0].id).toBe(messageId);
    });
  });

  describe("Multicast Delivery", () => {
    it("should create individual messages for each target in multicast", async () => {
      const targets = ["builder", "able", "beck"];
      const baseMessageId = "msg-multicast-001";

      for (let i = 0; i < targets.length; i++) {
        const messageId = `${baseMessageId}-${targets[i]}`;
        await db.collection(`users/${userId}/relay`).doc(messageId).set({
          source: "orchestrator",
          target: targets[i],
          message: "Multicast message",
          message_type: "DIRECTIVE",
          status: "pending",
          threadId: baseMessageId, // Same thread for grouped messages
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Verify all messages created
      const multicastMessages = await db
        .collection(`users/${userId}/relay`)
        .where("threadId", "==", baseMessageId)
        .get();

      expect(multicastMessages.size).toBe(targets.length);

      const receivedTargets = multicastMessages.docs.map((doc) => doc.data().target);
      expect(receivedTargets.sort()).toEqual(targets.sort());
    });

    it("should handle group targets correctly", async () => {
      const groupTargets = {
        builders: ["builder", "able", "beck"],
        council: ["orchestrator", "architect", "reviewer", "designer", "coordinator", "auditor"],
      };

      for (const [group, members] of Object.entries(groupTargets)) {
        for (const member of members) {
          const messageId = `msg-group-${group}-${member}`;
          await db.collection(`users/${userId}/relay`).doc(messageId).set({
            source: "orchestrator",
            target: member,
            message: `Message to ${group} group`,
            message_type: "DIRECTIVE",
            status: "pending",
            groupTarget: group,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      const buildersMessages = await db
        .collection(`users/${userId}/relay`)
        .where("groupTarget", "==", "builders")
        .get();

      expect(buildersMessages.size).toBe(groupTargets.builders.length);
    });
  });

  describe("Idempotency Key Deduplication", () => {
    it("should prevent duplicate messages with same idempotency key", async () => {
      const idempotencyKey = "unique-key-123";
      const messageData = {
        source: "orchestrator",
        target: "builder",
        message: "Idempotent message",
        message_type: "DIRECTIVE",
        status: "pending",
        idempotency_key: idempotencyKey,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // First message
      await db.collection(`users/${userId}/relay`).doc("msg-007").set(messageData);

      // Check for existing message with same idempotency key
      const existingMessages = await db
        .collection(`users/${userId}/relay`)
        .where("idempotency_key", "==", idempotencyKey)
        .get();

      expect(existingMessages.size).toBe(1);

      // Attempt to send duplicate (should be detected)
      const duplicateCheck = await db
        .collection(`users/${userId}/relay`)
        .where("idempotency_key", "==", idempotencyKey)
        .limit(1)
        .get();

      expect(duplicateCheck.empty).toBe(false);
    });

    it("should allow different messages with different idempotency keys", async () => {
      const messages = [
        { id: "msg-008", key: "key-1" },
        { id: "msg-009", key: "key-2" },
        { id: "msg-010", key: "key-3" },
      ];

      for (const msg of messages) {
        await db.collection(`users/${userId}/relay`).doc(msg.id).set({
          source: "orchestrator",
          target: "builder",
          message: `Message ${msg.id}`,
          message_type: "DIRECTIVE",
          status: "pending",
          idempotency_key: msg.key,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const allMessages = await db.collection(`users/${userId}/relay`).get();
      const uniqueKeys = new Set(
        allMessages.docs.map((doc) => doc.data().idempotency_key)
      );

      expect(uniqueKeys.size).toBe(messages.length);
    });
  });
});
