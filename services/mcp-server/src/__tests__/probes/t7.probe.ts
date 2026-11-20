import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { probe } from "./harness/registry";

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

const create = (title: string) => ({ title, target: "beta", source: "alpha", instructions: "t7" });

describe("T7 dispatch pause", () => {
  probe("T7.dispatch_denied", async () => {
    const w = world();
    const c = w.creds.scoped;
    const before = await callTool(w, c, "dispatch_create_task", create("t7-control"));
    expect(before.isError).toBe(false); // control: same call succeeds while the flag is off
    const denied = await withDispatchPaused(c.tenantUid, async () => ({
      create: await callTool(w, c, "dispatch_create_task", create("t7-denied")),
      alias: await callTool(w, c, "create_task", create("t7-denied-alias")),
      claim: await callTool(w, c, "dispatch_claim_task", { taskId: "does-not-matter" }),
    }));
    for (const r of Object.values(denied)) {
      expect(r.isError).toBe(true);
      expect(r.json?.error).toBe("DISPATCH_PAUSED");
    }
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
});
