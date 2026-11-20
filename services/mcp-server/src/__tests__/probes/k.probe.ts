import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { writeKey } from "./harness/seed";
import { nextN } from "./harness/cases";
import { emulatorDb } from "./harness/emulator";
import { denialNames } from "./harness/judge";
import type { World, WorldCredential } from "./harness/world";

/**
 * K (RD-5 PR-K, plan section 19 as revised by 19.1): the relay and dispatch families are bound to credentialPrincipal.
 */

/** A tenant-A credential of `programId` holding exactly `capabilities`. */
async function mint(w: World, programId: string, label: string, capabilities: string[]): Promise<WorldCredential> {
  const { key, keyHash } = await writeKey(w.tenants.A, programId, label, capabilities);
  return { name: "scoped", tenant: "A", tenantUid: w.tenants.A, programId, capabilities, key, keyHash };
}

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

  test("K.dispatcher_claimed_task_completes_by_target control: an unclaimed task is refused to the same key", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-k-beta-ctl", ["*"]);
    const taskId = await taskFor(w, "beta", nextN());
    const r = await complete(w, beta, taskId);
    expect(r.json?.success).toBe(false);
  });
});
