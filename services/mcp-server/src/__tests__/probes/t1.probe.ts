import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { probe } from "./harness/registry";
import { writeKey } from "./harness/seed";
import type { WorldCredential } from "./harness/world";

const keyDoc = async (hash: string) => (await emulatorDb().doc(`keyIndex/${hash}`).get()).data();

describe("T1 key list and revoke are bound to the calling program", () => {
  probe("T1.list", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "keys_list_keys", {});
    expect(r.json?.success).toBe(true);
    const keys: { programId: string; label: string; keyHash: string }[] = r.json.keys;
    // control: the list is not empty, and holds this program's own keys
    expect(keys.map((k) => k.label)).toEqual(expect.arrayContaining(["probe-scoped", "probe-restricted"]));
    // deny: nothing of another program's
    expect(keys.filter((k) => k.programId !== "alpha")).toEqual([]);
    expect(keys.map((k) => k.keyHash)).not.toContain(w.creds.observer.keyHash);
  });

  probe("T1.revoke", async () => {
    const w = world();
    const denied = await callTool(w, w.creds.scoped, "keys_revoke_key", { keyHash: w.creds.observer.keyHash });
    expect(denied.json?.success).toBe(false);
    expect(denied.json.error).toBe('Access denied: "alpha" cannot revoke a key belonging to "beta"'); // names the true principal
    expect((await keyDoc(w.creds.observer.keyHash))?.active).toBe(true);
    // control: same request shape, own key, succeeds and takes effect
    const own = await callTool(w, w.creds.scoped, "keys_revoke_key", { keyHash: w.creds.disposable.keyHash });
    expect(own.json?.success).toBe(true);
    expect((await keyDoc(w.creds.disposable.keyHash))?.active).toBe(false);
  });

  // RD-5 PR-F: key administration is a literal fleet.admin on the credential. The key below holds ["*", "fleet.admin"]
  // (the shape vector and sark hold live) under program beta.
  const fleetAdmin = async (): Promise<WorldCredential> => {
    const w = world();
    const k = await writeKey(w.tenants.A, "beta", "probe-fleet-admin", ["*", "fleet.admin"]);
    return { ...w.creds.admin, ...k, capabilities: ["*", "fleet.admin"] };
  };

  probe("T1.list_admin", async () => {
    const w = world();
    const admin = await fleetAdmin();
    const r = await callTool(w, admin, "keys_list_keys", {});
    expect(r.json?.success).toBe(true);
    const keys: { programId: string; keyHash: string }[] = r.json.keys;
    // lists more than its own program's keys, in its own tenant only
    expect(keys.map((k) => k.keyHash)).toEqual(expect.arrayContaining([admin.keyHash, w.creds.scoped.keyHash, w.creds.observer.keyHash]));
    expect(new Set(keys.map((k) => k.programId)).size).toBeGreaterThan(1);
    expect(keys.map((k) => k.keyHash)).not.toContain(w.creds.tenantB.keyHash);
  });

  probe("T1.list_wildcard", async () => {
    const w = world();
    // a ["*"] key without fleet.admin is not a key admin: own program only
    const r = await callTool(w, w.creds.wildcard, "keys_list_keys", {});
    expect(r.json?.success).toBe(true);
    const keys: { programId: string; keyHash: string }[] = r.json.keys;
    expect(keys.map((k) => k.keyHash)).toContain(w.creds.wildcard.keyHash); // control: its own key is listed
    expect(keys.filter((k) => k.programId !== "alpha")).toEqual([]);
    expect(keys.map((k) => k.keyHash)).not.toContain(w.creds.observer.keyHash);
  });

  probe("T1.revoke_admin", async () => {
    const w = world();
    const admin = await fleetAdmin();
    const spare = await writeKey(w.tenants.A, "alpha", "probe-throwaway", ["dispatch.read"]);
    // fleet.admin revokes another program's key
    const ok = await callTool(w, admin, "keys_revoke_key", { keyHash: spare.keyHash });
    expect(ok.json?.success).toBe(true);
    expect((await keyDoc(spare.keyHash))?.active).toBe(false);
    // control: ["*"] without fleet.admin cannot revoke another program's key
    const spare2 = await writeKey(w.tenants.A, "beta", "probe-throwaway-2", ["dispatch.read"]);
    const denied = await callTool(w, w.creds.wildcard, "keys_revoke_key", { keyHash: spare2.keyHash });
    expect(denied.json?.success).toBe(false);
    expect((await keyDoc(spare2.keyHash))?.active).toBe(true);
  });
});
