import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { writeKey } from "./harness/seed";
import { nextN } from "./harness/cases";
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
  const t = await callTool(w, w.seeders.A, "dispatch_create_task", { title: `k-${n}`, target, source: "legacy", instructions: `k-${n}` });
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

  test("K.dispatcher_claimed_task_completes_by_target control: an unclaimed task is refused to the same key", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-k-beta-ctl", ["*"]);
    const taskId = await taskFor(w, "beta", nextN());
    const r = await complete(w, beta, taskId);
    expect(r.json?.success).toBe(false);
  });
});
