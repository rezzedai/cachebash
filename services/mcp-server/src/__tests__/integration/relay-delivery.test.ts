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
import { getTestFirestore, clearFirestoreData, seedTestUser, seedTestData } from "./setup";

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

      await db.collection(`tenants/${userId}/relay`).doc(messageId).set(messageData);

      const messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
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
        await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
          source: "orchestrator",
          target: "builder",
          message: `${type} message`,
          message_type: type,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const allMessages = await db.collection(`tenants/${userId}/relay`).get();
      expect(allMessages.size).toBe(messageTypes.length);
    });

    it("should include optional payload field", async () => {
      const messageId = "msg-002";
      const payload = {
        taskId: "task-123",
        data: { foo: "bar", count: 42 },
      };

      await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Message with payload",
        message_type: "QUERY",
        status: "pending",
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
      const data = messageDoc.data();

      expect(data?.payload).toEqual(payload);
    });
  });

  describe("Message Status Transitions", () => {
    it("should transition from pending to delivered to read", async () => {
      const messageId = "msg-003";

      // Create message
      await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Transition test",
        message_type: "DIRECTIVE",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ensure document exists before updating
      let messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.exists).toBe(true);

      // Mark as delivered
      await db.collection(`tenants/${userId}/relay`).doc(messageId).update({
        status: "delivered",
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.data()?.status).toBe("delivered");
      expect(messageDoc.data()?.deliveredAt).toBeDefined();

      // Mark as read
      await db.collection(`tenants/${userId}/relay`).doc(messageId).update({
        status: "read",
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.data()?.status).toBe("read");
      expect(messageDoc.data()?.readAt).toBeDefined();
    });

    it("should handle failed delivery", async () => {
      const messageId = "msg-004";

      await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "Failed delivery",
        message_type: "DIRECTIVE",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ensure document exists before updating
      let messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
      expect(messageDoc.exists).toBe(true);

      await db.collection(`tenants/${userId}/relay`).doc(messageId).update({
        status: "failed",
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: "Target not reachable",
      });

      messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
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

      await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
        source: "orchestrator",
        target: "builder",
        message: "TTL test",
        message_type: "DIRECTIVE",
        status: "pending",
        ttl: ttlSeconds,
        createdAt,
        expiresAt,
      });

      const messageDoc = await db.collection(`tenants/${userId}/relay`).doc(messageId).get();
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

      await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
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
        .collection(`tenants/${userId}/relay`)
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
        await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
          source: "orchestrator",
          target: targets[i],
          message: "Multicast message",
          message_type: "DIRECTIVE",
          status: "pending",
          threadId: baseMessageId, // Same thread for grouped messages
          createdAt: admin.firestore.Timestamp.now(),
        });
      }

      // Verify all messages created
      const multicastMessages = await db
        .collection(`tenants/${userId}/relay`)
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
          await db.collection(`tenants/${userId}/relay`).doc(messageId).set({
            source: "orchestrator",
            target: member,
            message: `Message to ${group} group`,
            message_type: "DIRECTIVE",
            status: "pending",
            groupTarget: group,
            createdAt: admin.firestore.Timestamp.now(),
          });
        }
      }

      const buildersMessages = await db
        .collection(`tenants/${userId}/relay`)
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
      await db.collection(`tenants/${userId}/relay`).doc("msg-007").set(messageData);

      // Check for existing message with same idempotency key
      const existingMessages = await db
        .collection(`tenants/${userId}/relay`)
        .where("idempotency_key", "==", idempotencyKey)
        .get();

      expect(existingMessages.size).toBe(1);

      // Attempt to send duplicate (should be detected)
      const duplicateCheck = await db
        .collection(`tenants/${userId}/relay`)
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
        await db.collection(`tenants/${userId}/relay`).doc(msg.id).set({
          source: "orchestrator",
          target: "builder",
          message: `Message ${msg.id}`,
          message_type: "DIRECTIVE",
          status: "pending",
          idempotency_key: msg.key,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const allMessages = await db.collection(`tenants/${userId}/relay`).get();
      const uniqueKeys = new Set(
        allMessages.docs.map((doc) => doc.data().idempotency_key)
      );

      expect(uniqueKeys.size).toBe(messages.length);
    });
  });
});

/**
 * ADR-013: participant-scoped durable relay reads.
 *
 * SARK GO-WITH-CONTROLS (grid#716): C1 source/target coercion LOCK,
 * C2 single enforcement point for MCP + REST, C3 threadId-only LOCK,
 * C4 read-audit ledger detail. Tests call the real handlers against the
 * Firestore emulator; the REST test runs the real router over HTTP.
 */

// github-sync (pulled in via transport/rest -> tools) imports ESM-only
// @octokit/rest, which ts-jest does not transform — mock it out.
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import * as http from "http";
import * as crypto from "crypto";
import { initializeFirebase } from "../../firebase/client";
import {
  getMessagesHandler,
  getSentMessagesHandler,
  queryMessageHistoryHandler,
} from "../../modules/relay";
import { createRestRouter } from "../../transport/rest";
import type { AuthContext } from "../../auth/authValidator";

function makeAuth(userId: string, programId: string): AuthContext {
  return {
    userId,
    programId,
    capabilities: ["relay.read", "relay.write"],
    rateLimitTier: "free",
    apiKeyHash: `test-hash-${programId}`,
    encryptionKey: Buffer.alloc(32),
  } as unknown as AuthContext;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function ts(isoDate: string) {
  return admin.firestore.Timestamp.fromDate(new Date(isoDate));
}

describe("ADR-013 Participant-Scoped Durable Relay Reads", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
    initializeFirebase(); // point module-level handlers at the emulator
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-adr013");
    userId = testUser.userId;

    // Conversation thread t-adr: scalar<->iso, plus a third party (basher)
    // sharing the same thread, plus a broadcast.
    await seedTestData(userId, "relay", [
      { id: "m1", data: { source: "iso", target: "scalar", payload: "body-iso-to-scalar", message_type: "DIRECTIVE", status: "delivered", threadId: "t-adr", priority: "normal", action: "queue", createdAt: ts("2026-06-09T10:00:00Z") } },
      { id: "m2", data: { source: "scalar", target: "iso", payload: "body-scalar-to-iso", message_type: "ACK", status: "delivered", threadId: "t-adr", priority: "normal", action: "queue", createdAt: ts("2026-06-09T10:01:00Z") } },
      { id: "m3", data: { source: "iso", target: "basher", payload: "body-iso-to-basher", message_type: "DIRECTIVE", status: "delivered", threadId: "t-adr", priority: "normal", action: "queue", createdAt: ts("2026-06-09T10:02:00Z") } },
      { id: "m4", data: { source: "iso", target: "all", payload: "broadcast-body", message_type: "STATUS", status: "pending", threadId: "t-adr", priority: "normal", action: "queue", createdAt: ts("2026-06-09T10:03:00Z") } },
      { id: "m5", data: { source: "iso", target: "basher", payload: "body-other-thread", message_type: "QUERY", status: "pending", threadId: "t-other", priority: "normal", action: "queue", createdAt: ts("2026-06-09T10:04:00Z") } },
    ]);
  });

  describe("query_message_history — participant scoping (Option A)", () => {
    it("non-admin reads own received history with bodies", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { target: "scalar" }) as never);

      expect(res.success).toBe(true);
      expect(res.messages.map((m: any) => m.id)).toEqual(["m1"]);
      expect(res.messages[0].message).toBe("body-iso-to-scalar");
      expect(res.messages[0].status).toBe("delivered");
    });

    it("LOCK C1: non-admin source arg naming another program is rejected", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { source: "basher" }) as never);

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/participant scope/i);
      expect(res.messages).toBeUndefined();
    });

    it("LOCK C1: non-admin target arg naming another program is rejected", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { target: "basher" }) as never);

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/participant scope/i);
    });

    it("LOCK C1: non-admin cannot read a counterparty's outbox even via source=iso", async () => {
      // m3 (iso->basher) shares source iso with m1 (iso->scalar); a scalar key
      // naming source=iso would read basher's inbound traffic.
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { source: "iso" }) as never);

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/participant scope/i);
    });

    it("LOCK C3: threadId-only non-admin query stays participant-constrained", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { threadId: "t-adr" }) as never);

      expect(res.success).toBe(true);
      // Both directions + broadcast, ascending; m3 (iso->basher) must NOT leak
      expect(res.messages.map((m: any) => m.id)).toEqual(["m1", "m2", "m4"]);
      expect(res.sort).toBe("asc");
    });

    it("non-admin target='all' broadcast read is allowed", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { target: "all" }) as never);

      expect(res.success).toBe(true);
      expect(res.messages.map((m: any) => m.id)).toEqual(["m4"]);
    });

    it("admin paths unchanged: unrestricted third-party query", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "orchestrator"), { source: "iso" }) as never);

      expect(res.success).toBe(true);
      expect(res.messages.map((m: any) => m.id).sort()).toEqual(["m1", "m3", "m4", "m5"]);
    });

    it("admin threadId query returns every party's messages", async () => {
      const res = parse(await queryMessageHistoryHandler(makeAuth(userId, "orchestrator"), { threadId: "t-adr" }) as never);

      expect(res.success).toBe(true);
      expect(res.messages.map((m: any) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    });

    it("C4: history read ledgers effective filters, count, and message IDs", async () => {
      await queryMessageHistoryHandler(makeAuth(userId, "scalar"), { threadId: "t-adr" });

      // logAudit persists fire-and-forget — poll the ledger briefly
      let entry: any = null;
      for (let i = 0; i < 20 && !entry; i++) {
        // filter by programId too: fire-and-forget audit writes from prior
        // tests can land after clearFirestoreData
        const snap = await db.collection(`tenants/${userId}/ledger`)
          .where("tool", "==", "relay_query_message_history.read")
          .where("programId", "==", "scalar").get();
        if (!snap.empty) entry = snap.docs[0].data();
        else await new Promise((r) => setTimeout(r, 100));
      }

      expect(entry).not.toBeNull();
      expect(entry.programId).toBe("scalar");
      expect(entry.details.effectiveFilters.threadId).toBe("t-adr");
      expect(entry.details.effectiveFilters.participantScope).toBe("scalar");
      expect(entry.details.resultCount).toBe(3);
      expect(entry.details.messageIds.sort()).toEqual(["m1", "m2", "m4"]);
    });
  });

  describe("get_messages — includeDelivered (Option C)", () => {
    it("delivered re-read returns bodies and does NOT re-claim", async () => {
      const auth = makeAuth(userId, "scalar");

      // First poll claims the pending broadcast + nothing else for scalar
      const first = parse(await getMessagesHandler(auth, { sessionId: "scalar", markAsRead: true }) as never);
      expect(first.interrupts.map((m: any) => m.id)).toEqual(["m4"]);

      const afterClaim = (await db.doc(`tenants/${userId}/relay/m4`).get()).data()!;
      expect(afterClaim.status).toBe("delivered");
      expect(afterClaim.deliveryAttempts).toBe(1);

      // Default re-poll: empty inbox (pending window closed) — unchanged behavior
      const second = parse(await getMessagesHandler(auth, { sessionId: "scalar", markAsRead: true }) as never);
      expect(second.interrupts).toEqual([]);

      // includeDelivered re-opens the body read without re-claiming
      const reread = parse(await getMessagesHandler(auth, { sessionId: "scalar", markAsRead: true, includeDelivered: true }) as never);
      expect(reread.interrupts.map((m: any) => m.id).sort()).toEqual(["m1", "m4"]);
      const m4 = reread.interrupts.find((m: any) => m.id === "m4");
      expect(m4.message).toBe("broadcast-body");

      const afterReread = (await db.doc(`tenants/${userId}/relay/m4`).get()).data()!;
      expect(afterReread.deliveryAttempts).toBe(1); // no re-claim
    });

    it("includeDelivered read-only poll returns pending + delivered bodies, own target only", async () => {
      const res = parse(await getMessagesHandler(makeAuth(userId, "scalar"), { sessionId: "scalar", includeDelivered: true }) as never);

      // m1 (delivered, target scalar) + m4 (pending broadcast); never m3/m5 (basher's)
      expect(res.interrupts.map((m: any) => m.id).sort()).toEqual(["m1", "m4"]);
      const m1 = res.interrupts.find((m: any) => m.id === "m1");
      expect(m1.message).toBe("body-iso-to-scalar");
      expect(m1.status).toBe("delivered");
    });

    it("default behavior unchanged: pending only", async () => {
      const res = parse(await getMessagesHandler(makeAuth(userId, "scalar"), { sessionId: "scalar" }) as never);
      expect(res.interrupts.map((m: any) => m.id)).toEqual(["m4"]);
    });
  });

  describe("get_sent_messages — body inclusion", () => {
    it("sender re-reads own bodies", async () => {
      const res = parse(await getSentMessagesHandler(makeAuth(userId, "scalar"), {}) as never);

      expect(res.success).toBe(true);
      expect(res.messages.length).toBe(1);
      expect(res.messages[0].id).toBe("m2");
      expect(res.messages[0].message).toBe("body-scalar-to-iso");
    });

    it("non-admin source arg is still forced to self", async () => {
      const res = parse(await getSentMessagesHandler(makeAuth(userId, "scalar"), { source: "iso" }) as never);

      expect(res.source).toBe("scalar");
      expect(res.messages.map((m: any) => m.id)).toEqual(["m2"]);
    });
  });

  describe("REST transport — single enforcement point (C2)", () => {
    let server: http.Server;
    let baseUrl: string;
    let apiKey: string;

    beforeEach(async () => {
      // Seed a NON-admin participant key (programId scalar — in neither
      // ADMIN_PROGRAMS nor ADMIN_READERS, no wildcard capability)
      apiKey = `cb_test_${crypto.randomBytes(8).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
      await db.doc(`keyIndex/${keyHash}`).set({
        userId,
        programId: "scalar",
        capabilities: ["relay.read", "relay.write"],
        active: true,
      });

      server = http.createServer(createRestRouter());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    });

    it("GET /v1/messages/history with non-admin participant key returns own messages (no 403)", async () => {
      const res = await fetch(`${baseUrl}/v1/messages/history?threadId=t-adr`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const data = body.data ?? body;
      expect(data.success).toBe(true);
      expect(data.messages.map((m: any) => m.id)).toEqual(["m1", "m2", "m4"]);
    });

    it("GET /v1/messages/history third-party read rejected for non-admin key", async () => {
      const res = await fetch(`${baseUrl}/v1/messages/history?source=basher`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const body = await res.json() as any;
      const data = body.data ?? body;
      expect(data.success).toBe(false);
      expect(String(data.error)).toMatch(/participant scope/i);
    });
  });
});
