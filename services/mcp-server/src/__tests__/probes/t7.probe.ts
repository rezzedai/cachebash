import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { probe } from "./harness/registry";
import { seedTenant } from "./harness/seed";
import { MCP_SERVER_DIR } from "./harness/server";
import { assertEmulatorOnly } from "./harness/guard";
import { spawnSync } from "child_process";
import * as path from "path";
import * as crypto from "crypto";

/**
 * T7 (R9, A-7): with `dispatchPaused` set on the tenant's ceilings document, a dispatch call is denied with
 * DISPATCH_PAUSED and a boot call (gsp_bootstrap, mapped to gsp.write, so the wider `paused` switch would deny it)
 * succeeds. The flag is set by this harness straight into the emulator: no API handler writes it.
 * Probes run serially (maxWorkers 1) and each clears the flag in `finally`.
 */
async function withDispatchPaused<T>(tenantUid: string, fn: () => Promise<T>): Promise<T> {
  const ref = emulatorDb().doc(`tenants/${tenantUid}/_meta/ceilings`);
  await ref.update({ dispatchPaused: true });
  try {
    return await fn();
  } finally {
    await ref.update({ dispatchPaused: false });
  }
}

/**
 * Runs executeSchedulesForUser from the BUILT server code (the scratch build under a mutation run) in a child
 * process pointed at the emulator, with no ambient credentials, and returns its result.
 */
function runExecutor(tenantUid: string): { checked: number; fired: unknown[]; errors: number; skipped: number } {
  const target = assertEmulatorOnly();
  const dir = process.env.PROBE_SERVER_DIR || MCP_SERVER_DIR;
  const code = `
    const { initializeFirebase } = require(${JSON.stringify(path.join(dir, "dist/firebase/client.js"))});
    initializeFirebase();
    require(${JSON.stringify(path.join(dir, "dist/modules/schedule-executor.js"))})
      .executeSchedulesForUser(${JSON.stringify(tenantUid)})
      .then((r) => { process.stdout.write("RESULT:" + JSON.stringify(r)); process.exit(0); })
      .catch((e) => { console.error(e); process.exit(1); });`;
  const r = spawnSync(process.execPath, ["-e", code], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, FIREBASE_PROJECT_ID: target.projectId, GCLOUD_PROJECT: target.projectId, FIRESTORE_EMULATOR_HOST: target.emulatorHost },
  });
  const line = r.stdout.split("\n").find((l) => l.includes("RESULT:"));
  if (!line) throw new Error(`executor run failed: ${r.stderr.slice(0, 1500)}`);
  return JSON.parse(line.slice(line.indexOf("RESULT:") + 7));
}

const create = (title: string) => ({ title, target: "beta", source: "alpha", instructions: "t7" });

describe("T7 dispatch pause", () => {
  probe("T7.dispatch_denied", async () => {
    const w = world();
    const c = w.creds.scoped;
    const before = await callTool(w, c, "dispatch_create_task", create("t7-control"));
    expect(before.isError).toBe(false); // control: same call succeeds while the flag is off
    const sprintArgs = { projectName: "t7", branch: "t7", stories: [{ id: "s1", title: "t7" }] };
    const sprintBefore = await callTool(w, c, "sprint_create_sprint", sprintArgs);
    expect(sprintBefore.isError).toBe(false); // control: sprint creation works while the flag is off
    const taskId = before.json?.taskId ?? before.json?.id ?? before.json?.task?.id;
    expect(typeof taskId).toBe("string");
    const denied = await withDispatchPaused(c.tenantUid, async () => ({
      sprint: await callTool(w, c, "sprint_create_sprint", sprintArgs),
      create: await callTool(w, c, "dispatch_create_task", create("t7-denied")),
      alias: await callTool(w, c, "create_task", create("t7-denied-alias")),
      claim: await callTool(w, c, "dispatch_claim_task", { taskId: "does-not-matter" }),
      dream: await callTool(w, c, "dream_activate", { dreamId: "does-not-matter" }), // the breaker runs before the handler
    }));
    for (const r of Object.values(denied)) {
      expect(r.isError).toBe(true);
      expect(r.json?.error).toBe("DISPATCH_PAUSED");
    }
    // wind-down stays open: aborting the task created before the flag is not a pause denial
    const abort = await withDispatchPaused(c.tenantUid, () => callTool(w, c, "dispatch_abort_task", { taskId, reason: "t7 wind-down" }));
    expect(abort.text).not.toContain("DISPATCH_PAUSED");
    expect(abort.isError).toBe(false);
    const after = await callTool(w, c, "dispatch_create_task", create("t7-after"));
    expect(after.isError).toBe(false); // clearing the flag restores dispatch
  });

  probe("T7.boot_allowed_under_pause", async () => {
    const w = world();
    const c = w.creds.scoped;
    const r = await withDispatchPaused(c.tenantUid, async () => ({
      boot: await callTool(w, c, "gsp_bootstrap", { agentId: "alpha" }),
      state: await callTool(w, c, "state_get_program_state", { programId: "alpha" }),
      msgs: await callTool(w, c, "relay_get_messages", { sessionId: "t7", target: "alpha", markAsRead: false }),
      dispatch: await callTool(w, c, "dispatch_create_task", create("t7-denied-2")),
    }));
    expect(r.dispatch.json?.error).toBe("DISPATCH_PAUSED"); // control: the flag is in force during the boot call
    expect(r.boot.json?.success).toBe(true);
    expect(r.boot.json?.payload?.identity).toBeDefined();
    expect(r.state.isError).toBe(false);
    expect(r.msgs.isError).toBe(false);
  });

  probe("T7.schedule_skipped_under_pause", async () => {
    // own tenant: the executor fires every due schedule of the tenant it is given
    const tenantUid = `probe-t7-${crypto.randomBytes(4).toString("hex")}`;
    await seedTenant(tenantUid);
    const db = emulatorDb();
    const past = "2020-01-01T00:00:00.000Z";
    const ref = db.doc(`tenants/${tenantUid}/schedules/t7-sched`);
    await ref.set({ name: "t7-nightly", target: "beta", cron: "0 0 * * *", enabled: true, nextRunAt: past, taskTemplate: { title: "t7-sched-task" } });
    const taskCount = async () => (await db.collection(`tenants/${tenantUid}/tasks`).where("scheduleId", "==", "t7-sched").get()).size;
    const ceil = db.doc(`tenants/${tenantUid}/_meta/ceilings`);

    await ceil.update({ dispatchPaused: true });
    const paused = runExecutor(tenantUid);
    expect(paused.fired).toHaveLength(0);
    expect(paused.skipped).toBe(1);
    expect(await taskCount()).toBe(0);
    expect((await ref.get()).data()?.nextRunAt).toBe(past); // not advanced: it fires on the first run after the pause lifts

    await ceil.update({ dispatchPaused: false });
    const clear = runExecutor(tenantUid);
    expect(clear.fired).toHaveLength(1); // control: the same schedule fires once the flag is clear
    expect(clear.skipped).toBe(0);
    expect(await taskCount()).toBe(1);
  });
});
