import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { probe } from "./harness/registry";
import { FULL } from "./harness/seed";

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

  // RD-5 PR-C, VECTOR ruling kCAh8BiR: gsp_* store caller-keyed values, which is safe only because the tenant
  // segment of the path is built from auth.userId. Tenant A writes a row; tenant B asks for the same namespace and key.
  probe("T6.gsp_read", async () => {
    const w = world();
    const namespace = "t6-gsp-ns";
    const key = "t6-gsp-key";
    const value = "mk-A-gsp-t6-only";
    const wrote = await callTool(w, w.seeders.A, "gsp_write", { namespace, key, value, tier: "operational" });
    expect(wrote.json?.success).toBe(true);
    // control: tenant A reads its own row and gets it
    const own = await callTool(w, w.creds.wildcard, "gsp_read", { namespace, key });
    expect({ ok: !own.isError, sawOwn: own.text.includes(value) }).toEqual({ ok: true, sawOwn: true });
    // deny: tenant B, same namespace and key, gets nothing back
    const hit = await callTool(w, w.creds.tenantB, "gsp_read", { namespace, key });
    expect({ leaksA: hit.text.includes(value) || hit.text.includes(w.tenants.A) }).toEqual({ leaksA: false });
    expect({ found: hit.json?.found, entry: hit.json?.entry ?? null }).toEqual({ found: false, entry: null });
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
    expect(r.json).toEqual({ success: false, error: "Key not found" }); // identical to a missing key: the hash is no existence oracle
    const missing = await callTool(w, w.creds.tenantB, "keys_revoke_key", { keyHash: "0".repeat(64) });
    expect(missing.json).toEqual(r.json);
    expect((await emulatorDb().doc(`keyIndex/${target.keyHash}`).get()).data()?.active).toBe(true);
    // control: the same call on tenant B's own (spare) key works
    const spare = await writeKey(w.tenants.B, "alpha", "probe-b-spare", FULL());
    const own = await callTool(w, w.creds.tenantB, "keys_revoke_key", { keyHash: spare.keyHash });
    expect(own.json?.success).toBe(true);
    expect((await emulatorDb().doc(`keyIndex/${spare.keyHash}`).get()).data()?.active).toBe(false);
  });

  // RD-5 PR-E, amendment 4: tenant equality compares RESOLVED tenants. A key whose raw userId is an alternate uid of
  // the caller's canonical tenant (the old dispatcher key 69cc7291 in T0NWeYZI, alternate of 7viFKVtl) is in the tenant.
  probe("T6.alt_uid_keys", async () => {
    const w = world();
    const alt = `probe-alt-${w.tenants.A}`;
    const db = emulatorDb();
    await db.doc(`canonical_accounts/t6-alt-${w.tenants.A}`).set({ email: "t6-alt@example.invalid", canonicalUid: w.tenants.A, alternateUids: [alt] });
    const mine = await writeKey(alt, "alpha", "probe-alt-alpha", FULL());
    const theirs = await writeKey(alt, "beta", "probe-alt-beta", FULL());
    // control: the same program, same tenant, sees and revokes the alternate-uid key
    const list = await callTool(w, w.creds.scoped, "keys_list_keys", {});
    expect(list.json?.success).toBe(true);
    expect(list.text).toContain(mine.keyHash);
    // deny: another program's alternate-uid key is neither listed nor revocable by a non-admin
    expect(list.text).not.toContain(theirs.keyHash);
    const denied = await callTool(w, w.creds.scoped, "keys_revoke_key", { keyHash: theirs.keyHash });
    expect(denied.json?.success).toBe(false);
    expect((await db.doc(`keyIndex/${theirs.keyHash}`).get()).data()?.active).toBe(true);
    // deny: tenant B sees none of it, and the answer to a revoke is "Key not found"
    const bList = await callTool(w, w.creds.tenantB, "keys_list_keys", {});
    expect(bList.text).not.toContain(mine.keyHash);
    const bRev = await callTool(w, w.creds.tenantB, "keys_revoke_key", { keyHash: mine.keyHash });
    expect(bRev.json).toEqual({ success: false, error: "Key not found" });
    // control: the same program revokes it
    const own = await callTool(w, w.creds.scoped, "keys_revoke_key", { keyHash: mine.keyHash });
    expect(own.json?.success).toBe(true);
    expect((await db.doc(`keyIndex/${mine.keyHash}`).get()).data()?.active).toBe(false);
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
  // Closed in PR-L (L-D10 option 2): the canonical account must be the caller's own tenant.
  probe("T6.admin_merge_accounts_legacy_cross_tenant", async () => {
    const w = world();
    const email = "t6-legacy-victim@example.invalid";
    const hit = await callTool(w, w.seeders.B, "admin_merge_accounts", { email, canonicalUid: w.tenants.A, alternateUid: "t6-legacy-alt" });
    expect(hit.json?.success).toBe(false);
    expect((await emulatorDb().collection("canonical_accounts").where("email", "==", email).get()).size).toBe(0);
  });
});
