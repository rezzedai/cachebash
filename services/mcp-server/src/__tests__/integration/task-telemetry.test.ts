/**
 * B4 (Wave B tail): post-completion telemetry stamp.
 *
 * Completers rarely pass tokens/cost to complete_task — the host hook
 * measures real deltas from stats-cache.json and records them after the
 * fact via record_task_telemetry. Proof: a synthetic task completed
 * WITHOUT telemetry gets tokens_in/out + cost_usd populated through the
 * real REST route, without the completer passing them; self-reported
 * values are never overwritten; third-party programs are rejected.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import * as http from "http";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser, seedTestData } from "./setup";
import { initializeFirebase } from "../../firebase/client";
import { claimTaskHandler } from "../../modules/dispatch/claims";
import { completeTaskHandler, recordTaskTelemetryHandler } from "../../modules/dispatch/completion";
import { createRestRouter } from "../../transport/rest";
import type { AuthContext } from "../../auth/authValidator";

function makeAuth(userId: string, programId: string): AuthContext {
  return {
    userId,
    programId,
    capabilities: ["dispatch.read", "dispatch.write", "relay.read", "relay.write"],
    rateLimitTier: "free",
    apiKeyHash: `test-hash-${programId}`,
    encryptionKey: Buffer.alloc(32),
  } as unknown as AuthContext;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("B4 Task Telemetry Capture", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
    initializeFirebase();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const u = await seedTestUser("test-user-b4");
    userId = u.userId;
    await seedTestData(userId, "tasks", [
      { id: "t-b4", data: { type: "task", title: "synthetic B4 proof task", status: "created", source: "iso", target: "basher", priority: "normal", action: "queue", createdAt: admin.firestore.FieldValue.serverTimestamp() } },
    ]);
    const basher = makeAuth(userId, "basher");
    parse(await claimTaskHandler(basher, { taskId: "t-b4", sessionId: "basher" }) as never);
    // Complete WITHOUT tokens/cost — the 87%-null case
    const done = parse(await completeTaskHandler(basher, { taskId: "t-b4", model: "claude-fable-5", provider: "anthropic", result: "done" }) as never);
    expect(done.success).toBe(true);
  });

  it("REST POST /v1/tasks/:id/telemetry populates measured tokens without completer self-report", async () => {
    const apiKey = `cb_test_${crypto.randomBytes(8).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    await db.doc(`keyIndex/${keyHash}`).set({
      userId, programId: "basher",
      capabilities: ["dispatch.read", "dispatch.write"],
      active: true,
    });

    const server = http.createServer(createRestRouter());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/tasks/t-b4/telemetry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tokens_in: 123456, tokens_out: 7890, cost_usd: 1.23, telemetry_source: "host-hook" }),
      });
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    }

    const doc = (await db.doc(`tenants/${userId}/tasks/t-b4`).get()).data()!;
    expect(doc.tokens_in).toBe(123456);
    expect(doc.tokens_out).toBe(7890);
    expect(doc.cost_usd).toBe(1.23);
    expect(doc.telemetry_source).toBe("host-hook");
  });

  it("never overwrites self-reported values (fill-if-null only)", async () => {
    await db.doc(`tenants/${userId}/tasks/t-b4`).update({ tokens_out: 555 });

    const res = parse(await recordTaskTelemetryHandler(makeAuth(userId, "basher"), { taskId: "t-b4", tokens_in: 100, tokens_out: 999 }) as never);

    expect(res.success).toBe(true);
    expect(res.updated).toEqual(["tokens_in"]);
    expect(res.skipped).toContain("tokens_out");
    const doc = (await db.doc(`tenants/${userId}/tasks/t-b4`).get()).data()!;
    expect(doc.tokens_out).toBe(555);
    expect(doc.tokens_in).toBe(100);
  });

  it("rejects third-party programs and non-completed tasks", async () => {
    const other = parse(await recordTaskTelemetryHandler(makeAuth(userId, "quorra"), { taskId: "t-b4", tokens_in: 1 }) as never);
    expect(other.success).toBe(false);

    await seedTestData(userId, "tasks", [
      { id: "t-open", data: { type: "task", title: "open", status: "created", source: "iso", target: "basher", createdAt: admin.firestore.FieldValue.serverTimestamp() } },
    ]);
    const open = parse(await recordTaskTelemetryHandler(makeAuth(userId, "basher"), { taskId: "t-open", tokens_in: 1 }) as never);
    expect(open.success).toBe(false);
    expect(open.error).toMatch(/completed tasks/i);
  });
});
