import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { probe } from "./harness/registry";

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
});
