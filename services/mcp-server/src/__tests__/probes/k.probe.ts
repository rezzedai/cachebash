import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { nextN } from "./harness/cases";
import { emulatorDb } from "./harness/emulator";
import { Timestamp } from "firebase-admin/firestore";
import { denialNames, sees } from "./harness/judge";
import { marker, sentMarker } from "./harness/data";
import type { World, WorldCredential } from "./harness/world";

/**
 * K (RD-5 PR-K, plan section 19 as revised by 19.1): the relay and dispatch families are bound to credentialPrincipal.
 */

const taskFor = async (w: World, target: string, n: string): Promise<string> => {
  const t = await callTool(w, w.seeders.A, "dispatch_create_task", { title: `k-${n}`, target, source: "legacy", instructions: `ki-${n}` });
  if (!t.json?.taskId) throw new Error(`task setup failed: ${t.text.slice(0, 300)}`);
  return t.json.taskId as string;
};

const complete = (w: World, cred: WorldCredential, taskId: string) =>
  callTool(w, cred, "dispatch_complete_task", { taskId, completed_status: "SUCCESS", model: "probe", provider: "probe", result: "k" });

describe("K relay and dispatch", () => {
  // 19.1: the dispatcher claims for a builder (claimedBy "dispatcher", sessionId = the builder's program), and the builder completes.
  probe("K.dispatcher_claimed_task_completes_by_target", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-k-dispatcher", ["*"]);
    const beta = await mint(w, "beta", "probe-k-beta", ["*"]);
    const taskId = await taskFor(w, "beta", nextN());
    const claim = await callTool(w, dispatcher, "dispatch_claim_task", { taskId, sessionId: "beta" });
    expect(claim.json?.success).toBe(true);
    const done = await complete(w, beta, taskId);
    expect(done.json?.success).toBe(true);
    const row = await callTool(w, w.seeders.A, "dispatch_get_task_by_id", { taskId });
    expect(row.json?.task?.status).toBe("done");
  });

  // K-D1: sessionId is attribution. A caller never owns another program's active task by naming or omitting a session.
  probe("K.claim_session_not_ownership", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-k-alpha-own", ["*"]);
    const beta = await mint(w, "beta", "probe-k-beta-own", ["*"]);
    const n = nextN();
    const taskId = await taskFor(w, "alpha", n);
    const mine = await callTool(w, alpha, "dispatch_claim_task", { taskId, sessionId: "alpha-s9" });
    expect(mine.json?.success).toBe(true);
    const again = await callTool(w, alpha, "dispatch_claim_task", { taskId, sessionId: "alpha-s9" });
    expect(again.json?.alreadyClaimed).toBe(true); // control: the owner's re-claim is idempotent
    for (const args of [{ taskId, sessionId: "alpha-s9" }, { taskId }]) { // alpha's session id, then none (null equals null)
      const r = await callTool(w, beta, "dispatch_claim_task", args);
      expect(r.json?.alreadyClaimed).not.toBe(true);
      expect(r.text).not.toContain(`ki-${n}`);
    }
    const batch = await callTool(w, beta, "dispatch_batch_claim_tasks", { taskIds: [taskId], sessionId: "alpha-s9" });
    expect(batch.text).not.toContain(`ki-${n}`);
  });

  // K-D1: the generic session-owns-task rule is gone. Only the dispatcher's delegated claim names a session as owner.
  probe("K.session_cannot_complete", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-k-alpha-sc", ["*"]);
    const beta = await mint(w, "beta", "probe-k-beta-sc", ["*"]);
    const own = await taskFor(w, "alpha", nextN());
    expect((await callTool(w, alpha, "dispatch_claim_task", { taskId: own, sessionId: "beta" })).json?.success).toBe(true);
    expect((await complete(w, alpha, own)).json?.success).toBe(true); // control: the claiming owner completes
    const taskId = await taskFor(w, "alpha", nextN());
    expect((await callTool(w, alpha, "dispatch_claim_task", { taskId, sessionId: "beta" })).json?.success).toBe(true);
    const r = await complete(w, beta, taskId);
    expect(r.json?.success).toBe(false);
    expect(denialNames(r, "beta")).toBe(true);
    const row = await callTool(w, w.seeders.A, "dispatch_get_task_by_id", { taskId });
    expect(row.json?.task?.status).toBe("active");
  });

  // VECTOR wT2tk4EA: the delegated branch of isTaskOwner is safe only while claimedBy comes from the credential (claims.ts claimedBy: principal).
  probe("K.claimed_by_unforgeable", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-k-alpha-forge", ["*"]);
    const beta = await mint(w, "beta", "probe-k-beta-forge", ["*"]);
    const stored = async (taskId: string) => (await emulatorDb().doc(`tenants/${w.tenants.A}/tasks/${taskId}`).get()).data()?.claimedBy;
    const t1 = await taskFor(w, "alpha", nextN());
    const t2 = await taskFor(w, "alpha", nextN());
    const honest = await callTool(w, alpha, "dispatch_claim_task", { taskId: t1, sessionId: "beta" });
    expect(honest.json?.success).toBe(true);
    expect(await stored(t1)).toBe("alpha"); // control: an honest claim stores the principal
    const forged = await callTool(w, alpha, "dispatch_claim_task", { taskId: t2, sessionId: "beta", claimedBy: "dispatcher" });
    expect(forged.json?.success).toBe(true);
    expect(await stored(t2)).toBe("alpha");
    const t3 = await taskFor(w, "alpha", nextN());
    const batch = await callTool(w, alpha, "dispatch_batch_claim_tasks", { taskIds: [t3], sessionId: "beta", claimedBy: "dispatcher" });
    expect(batch.json?.success).toBe(true);
    expect(await stored(t3)).toBe("alpha");
    expect((await complete(w, beta, t2)).json?.success).toBe(false); // beta is not the owner of a forged delegated claim
  });

  const TASKS = { requires_action: null, status: "all", limit: 50 } as const;

  // Row 7: an explicit foreign target needs the literal fleet.observe capability; "*" is not it.
  probe("K.get_tasks_denial_names", async () => {
    const w = world();
    const r = await callTool(w, w.creds.wildcard, "dispatch_get_tasks", { ...TASKS, target: "beta" });
    expect(denialNames(r, "alpha")).toBe(true);
    expect(r.text).not.toContain(marker("A", "beta"));
    const ok = await callTool(w, w.creds.observer, "dispatch_get_tasks", { ...TASKS, target: "alpha" });
    expect(sees(ok, marker("A", "alpha"))).toBe(true); // control: fleet.observe reads a foreign target
  });

  probe("K.get_tasks_observer_reads_foreign", async () => {
    const w = world();
    const r = await callTool(w, w.creds.observer, "dispatch_get_tasks", { ...TASKS, target: "alpha" });
    expect(sees(r, marker("A", "alpha"))).toBe(true);
    const denied = await callTool(w, w.creds.scoped, "dispatch_get_tasks", { ...TASKS, target: "beta" });
    expect(denialNames(denied, "alpha")).toBe(true); // control: a key without fleet.observe is refused
  });

  // GETTASKS-DEFAULT: no target means own queue plus broadcast, except for the all-reading principals.
  probe("K.get_tasks_default_scope", async () => {
    const w = world();
    const n = nextN();
    await taskFor(w, "alpha", `a${n}`);
    await taskFor(w, "beta", `b${n}`);
    const dispatcher = await mint(w, "dispatcher", "probe-k-dispatcher-list", ["*"]);
    const both = await callTool(w, dispatcher, "dispatch_get_tasks", TASKS);
    expect(both.text).toContain(`k-a${n}`);
    expect(both.text).toContain(`k-b${n}`); // control: the dispatcher key sees every target
    const r = await callTool(w, w.creds.scoped, "dispatch_get_tasks", TASKS);
    expect(r.text).toContain(`k-a${n}`);
    expect(r.text).not.toContain(`k-b${n}`);
  });

  const pendingFor = async (w: World, id: string) => (await emulatorDb().doc(`tenants/${w.tenants.A}/relay/${id}`).get()).data();
  const pendingCount = async (w: World, target: string) =>
    (await emulatorDb().collection(`tenants/${w.tenants.A}/relay`).where("target", "==", target).where("status", "==", "pending").get()).size;

  // R6, K-D2 option 2: a foreign target, or a sessionId that names another program, is refused before anything is read or claimed.
  probe("K.relay_foreign_direct_denied", async () => {
    const w = world();
    const own = await callTool(w, w.creds.scoped, "relay_get_messages", { sessionId: "alpha-s1", markAsRead: false });
    expect(sees(own, marker("A", "alpha"))).toBe(true); // control: the key's own inbox
    const before = await pendingCount(w, "beta");
    for (const args of [{ sessionId: "alpha-s1", target: "beta" }, { sessionId: "beta" }]) {
      const r = await callTool(w, w.creds.scoped, "relay_get_messages", { ...args, markAsRead: true });
      expect(denialNames(r, "alpha")).toBe(true);
      expect(r.text).not.toContain(marker("A", "beta"));
    }
    expect(await pendingCount(w, "beta")).toBe(before);
  });

  probe("K.relay_dispatcher_exemption", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-k-dispatcher-read", ["*"]);
    const r = await callTool(w, dispatcher, "relay_get_messages", { sessionId: "dispatcher-s1", target: "beta", markAsRead: false });
    expect(sees(r, marker("A", "beta"))).toBe(true);
    const denied = await callTool(w, w.creds.scoped, "relay_get_messages", { sessionId: "alpha-s1", target: "beta", markAsRead: false });
    expect(denialNames(denied, "alpha")).toBe(true); // control: a program key is refused the same read
  });

  // R6a: a broadcast is returned read-only to every reader and never claimed. Fresh programs keep alpha's and beta's seeded inboxes intact.
  probe("K.broadcast_read_does_not_claim", async () => {
    const w = world();
    const n = nextN();
    const [p1, p2] = [`kb1${n}`, `kb2${n}`];
    const db = emulatorDb();
    for (const p of [p1, p2]) {
      await db.doc(`tenants/${w.tenants.A}/programs/${p}`).set({
        programId: p, displayName: p, role: "custom", color: "#808080", groups: [], tags: [],
        createdAt: Timestamp.now(), createdBy: "probe-k", active: true,
      });
    }
    const relayDoc = (target: string, tag: string) => ({
      source: "legacy", target, message: tag, message_type: "STATUS", priority: "normal", action: "queue", status: "pending",
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 3600_000),
    });
    const bc = await db.collection(`tenants/${w.tenants.A}/relay`).add(relayDoc("all", `bc-${n}`));
    const r1 = await mint(w, p1, "probe-k-bc1", ["*"]);
    const r2 = await mint(w, p2, "probe-k-bc2", ["*"]);
    for (const reader of [r1, r2]) {
      const r = await callTool(w, reader, "relay_get_messages", { sessionId: `${reader.programId}-s1`, markAsRead: true });
      expect(r.text).toContain(`bc-${n}`);
      const doc = await pendingFor(w, bc.id);
      expect(doc?.status).toBe("pending");
      expect(doc?.deliveryAttempts ?? 0).toBe(0);
    }
    const direct = await db.collection(`tenants/${w.tenants.A}/relay`).add(relayDoc(p1, `dm-${n}`));
    const mine = await callTool(w, r1, "relay_get_messages", { sessionId: `${p1}-s1`, markAsRead: true });
    expect(mine.text).toContain(`dm-${n}`);
    const d = await pendingFor(w, direct.id);
    expect(d?.status).toBe("delivered"); // control: a direct message is claimed, and the counter moves
    expect(d?.deliveryAttempts).toBe(1);
  });

  probe("K.sent_messages_foreign_denied", async () => {
    const w = world();
    const own = await callTool(w, w.creds.scoped, "relay_get_sent_messages", { source: "alpha" });
    expect(sees(own, sentMarker("A", "alpha"))).toBe(true); // control: the caller's own sent messages
    const r = await callTool(w, w.creds.scoped, "relay_get_sent_messages", { source: "beta" });
    expect(denialNames(r, "alpha")).toBe(true);
    expect(r.text).not.toContain(sentMarker("A", "beta"));
  });

  // VERIFYSOURCE-ADMIN: `legacy` no longer sends as another source; `mobile` still may.
  probe("K.source_pinned_for_legacy", async () => {
    const w = world();
    const legacy = await mint(w, "legacy", "probe-k-legacy", ["*"]);
    const send = (cred: WorldCredential) =>
      callTool(w, cred, "relay_send_message", { message: `kp-${nextN()}`, source: "beta", target: "alpha", message_type: "STATUS" });
    const ok = await send(w.stateSeeders.A);
    expect(ok.json?.success).toBe(true); // control: mobile sends as any source
    const r = await send(legacy);
    expect(r.text).toContain("Source mismatch");
    expect(denialNames(r, "legacy")).toBe(true);
  });

  test("K.dispatcher_claimed_task_completes_by_target control: an unclaimed task is refused to the same key", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-k-beta-ctl", ["*"]);
    const taskId = await taskFor(w, "beta", nextN());
    const r = await complete(w, beta, taskId);
    expect(r.json?.success).toBe(false);
  });
});
