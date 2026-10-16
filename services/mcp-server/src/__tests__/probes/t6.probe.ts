import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { probe } from "./harness/registry";

/**
 * T6: tenant B's wildcard credential, program name `alpha` (the same name as tenant A's on purpose),
 * reaches nothing of tenant A's. Every read has a paired control: the same call returns tenant B's own seeded rows.
 */
const READS: { tool: string; args: (p: "alpha" | "beta") => Record<string, unknown> }[] = [
  { tool: "state_get_program_state", args: (p) => ({ programId: p }) },
  { tool: "state_recall_memory", args: (p) => ({ programId: p }) },
  { tool: "state_get_context_history", args: (p) => ({ programId: p }) },
  { tool: "pulse_list_sessions", args: (p) => ({ programId: p, limit: 50 }) },
  { tool: "dispatch_get_tasks", args: (p) => ({ target: p, requires_action: null, status: "all", limit: 50 }) },
  { tool: "relay_get_messages", args: (p) => ({ sessionId: `t6-${p}`, target: p, markAsRead: false, includeDelivered: true }) },
  { tool: "relay_get_sent_messages", args: (p) => ({ source: p }) },
  { tool: "schedule_list", args: (p) => ({ target: p }) },
  { tool: "gsp_bootstrap", args: (p) => ({ agentId: p, depth: "standard" }) },
];

describe("T6 tenant isolation", () => {
  probe("T6.reads", async () => {
    const w = world();
    for (const { tool, args } of READS) {
      // subject beta: tenant B's program alpha is not beta, so use "alpha" where the call is self-shaped
      for (const p of ["alpha"] as const) {
        const r = await callTool(w, w.creds.tenantB, tool, args(p));
        const where = `${tool}(${p}) as tenantB`;
        expect({ where, ok: !r.isError }).toEqual({ where, ok: true });
        // control: tenant B's own seeded rows come back
        const ownMarker = tool === "relay_get_sent_messages" ? `sm-B-${p}` : `mk-B-${p}`;
        expect({ where, sawOwn: r.text.includes(ownMarker) }).toEqual({ where, sawOwn: true });
        // deny: not one row, id or uid of tenant A
        expect({ where, leaksA: /mk-A-|sm-A-/.test(r.text) || r.text.includes(w.tenants.A) }).toEqual({ where, leaksA: false });
      }
    }
  });

  probe("T6.keys", async () => {
    const w = world();
    // list: only tenant B's keys, and they are there (control)
    const list = await callTool(w, w.creds.tenantB, "keys_list_keys", {});
    expect(list.json?.success).toBe(true);
    expect(list.text).toContain(w.creds.tenantB.keyHash);
    for (const c of Object.values(w.creds)) if (c.tenant === "A") expect(list.text).not.toContain(c.keyHash);
    // revoke tenant A's `alpha` key by hash: same program name, other tenant
    const target = w.creds.restricted;
    const r = await callTool(w, w.creds.tenantB, "keys_revoke_key", { keyHash: target.keyHash });
    expect(r.json?.success).toBe(false);
    expect((await emulatorDb().doc(`keyIndex/${target.keyHash}`).get()).data()?.active).toBe(true);
    // control: the same call on tenant B's own (spare) key works
    const spare = await writeKey(w.tenants.B, "alpha", "probe-b-spare", ["*"]);
    const own = await callTool(w, w.creds.tenantB, "keys_revoke_key", { keyHash: spare.keyHash });
    expect(own.json?.success).toBe(true);
    expect((await emulatorDb().doc(`keyIndex/${spare.keyHash}`).get()).data()?.active).toBe(false);
  });

  probe("T6.admin_merge_accounts", async () => {
    const w = world();
    const email = "t6-victim@example.invalid";
    const hit = await callTool(w, w.creds.tenantB, "admin_merge_accounts", { email, canonicalUid: w.tenants.A, alternateUid: w.tenants.B });
    expect(hit.json?.success).toBe(false);
    const docs = await emulatorDb().collection("canonical_accounts").where("email", "==", email).get();
    expect(docs.size).toBe(0);
    // control: a credential that passes the handler's gate (tenant B's legacy seeder) does write, so "no document" is not an empty-database artefact
    const ok = await callTool(w, w.seeders.B, "admin_merge_accounts", { email, canonicalUid: w.tenants.B, alternateUid: "t6-alt" });
    expect(ok.json?.success).toBe(true);
    expect((await emulatorDb().collection("canonical_accounts").where("email", "==", email).get()).size).toBe(1);
  });

  // PR-B finding 2, pinned on VECTOR's review: the gate passes any legacy key, and nothing compares
  // canonicalUid to the caller's tenant, so tenant B's legacy seeder folds a uid into tenant A's account.
  // Known-open: this probe asserts the DENIAL, so it fails today and runs as test.failing until the fix.
  probe("T6.admin_merge_accounts_legacy_cross_tenant", async () => {
    const w = world();
    const email = "t6-legacy-victim@example.invalid";
    const hit = await callTool(w, w.seeders.B, "admin_merge_accounts", { email, canonicalUid: w.tenants.A, alternateUid: "t6-legacy-alt" });
    expect(hit.json?.success).toBe(false);
    expect((await emulatorDb().collection("canonical_accounts").where("email", "==", email).get()).size).toBe(0);
  });
});
