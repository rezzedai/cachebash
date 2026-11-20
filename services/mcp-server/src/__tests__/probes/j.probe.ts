import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { denialNames } from "./harness/judge";
import { probe } from "./harness/registry";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { marker } from "./harness/data";
import type { World, WorldCredential } from "./harness/world";
import { Timestamp } from "firebase-admin/firestore";

/**
 * J (RD-5 PR-J, C-4): the program-state family is bound to credentialPrincipal.
 * - a foreign get_program_state with literal fleet.observe gets the document minus learnedPatterns and
 *   contextSummary, with memory.status "omitted", and never writes;
 * - recall_memory, memory_health, get_context_history and every writer are self-only;
 * - gsp_search scope memory returns the caller's own patterns only.
 * Alpha's seeded memory (marker mk-A-alpha) is in the contextSummary handoff notes and in one learned pattern.
 */
const ALPHA = marker("A", "alpha");
const BETA = marker("A", "beta");

/** A tenant-A credential of `programId` holding exactly `capabilities` (the shared observer lacks state.write and gsp.read). */
async function mint(w: World, programId: string, label: string, capabilities: string[]): Promise<WorldCredential> {
  const { key, keyHash } = await writeKey(w.tenants.A, programId, label, capabilities);
  return { name: "scoped", tenant: "A", tenantUid: w.tenants.A, programId, capabilities, key, keyHash };
}

const stateDocPath = (w: World, programId: string) => `tenants/${w.tenants.A}/sessions/_meta/program_state/${programId}`;

describe("J program state", () => {
  probe("J.foreign_state_omits_memory", async () => {
    const w = world();
    const self = await callTool(w, w.creds.scoped, "state_get_program_state", { programId: "alpha" });
    expect(self.json?.success).toBe(true); // control: the peer's own read returns both memory fields
    expect(self.json.state.learnedPatterns.length).toBeGreaterThan(0);
    expect(JSON.stringify(self.json.state.contextSummary)).toContain(ALPHA);
    expect(self.json.memory.status).toBe("loaded");

    const r = await callTool(w, w.creds.observer, "state_get_program_state", { programId: "alpha" });
    expect(r.json?.success).toBe(true); // fleet.observe widens the read
    expect(r.json.state.programId).toBe("alpha"); // the rest of the document is there
    expect(r.json.state.learnedPatterns).toBeUndefined();
    expect(r.json.state.contextSummary).toBeUndefined();
    expect(r.json.memory.status).toBe("omitted");
    expect(r.json.memory.omitted).toBe(true);
    expect(r.text).not.toContain(ALPHA);
  });

  probe("J.foreign_state_denied", async () => {
    const w = world();
    const own = await callTool(w, w.creds.wildcard, "state_get_program_state", { programId: "alpha" });
    expect(own.json?.success).toBe(true); // control: the same credential reads its own program
    for (const cred of [w.creds.wildcard, w.creds.scoped]) { // "*" is not fleet.observe; neither is a full named set
      const r = await callTool(w, cred, "state_get_program_state", { programId: "beta" });
      expect(r.json?.success).toBe(false);
      expect(denialNames(r, "alpha")).toBe(true);
      expect(r.text).not.toContain(BETA);
    }
  });

  probe("J.foreign_read_never_writes", async () => {
    const w = world();
    const target = `jdecay${Date.now().toString(36)}`;
    const db = emulatorDb();
    await db.doc(`tenants/${w.tenants.A}/programs/${target}`).set({
      programId: target, displayName: target, role: "custom", color: "#808080", groups: [], tags: [],
      createdAt: Timestamp.now(), createdBy: "probe-j", active: true,
    });
    const old = new Date(Date.now() - 90 * 86400000).toISOString(); // past learnedPatternMaxAge (30 days): decay is due
    const seeded = await callTool(w, w.stateSeeders.A, "state_store_memory", {
      programId: target,
      pattern: { id: "j-old", domain: "probe", pattern: "j-old", confidence: 0.5, evidence: "j", discoveredAt: old, lastReinforced: old },
    });
    expect(seeded.json?.success).toBe(true);
    const snap = async () => JSON.stringify((await db.doc(stateDocPath(w, target)).get()).data());
    const before = await snap();
    expect(before).toContain('"stale":false'); // decay is pending

    const foreign = await callTool(w, w.creds.observer, "state_get_program_state", { programId: target });
    expect(foreign.json?.success).toBe(true);
    expect(await snap()).toBe(before); // byte-identical: no decay write-back

    const self = await mint(w, target, "probe-j-self", ["state.read"]);
    const mine = await callTool(w, self, "state_get_program_state", { programId: target });
    expect(mine.json?.success).toBe(true); // control: the program's own read applies the decay
    expect(await snap()).not.toBe(before);
    expect(await snap()).toContain('"stale":true');
  });

  probe("J.memory_tools_self_only", async () => {
    const w = world();
    const observer = await mint(w, "beta", "probe-j-observer", ["state.read", "state.write", "fleet.observe"]);
    const owner = await mint(w, "alpha", "probe-j-owner", ["state.read", "state.write"]);
    const now = new Date().toISOString();
    const pattern = { id: "j-mem", domain: "probe", pattern: "j-mem", confidence: 0.5, evidence: "j", discoveredAt: now, lastReinforced: now };
    const calls: [string, Record<string, unknown>][] = [
      ["state_recall_memory", { programId: "alpha" }],
      ["state_memory_health", { programId: "alpha" }],
      ["state_get_context_history", { programId: "alpha" }],
      ["state_store_memory", { programId: "alpha", pattern }],
    ];
    for (const [tool, args] of calls) {
      const ok = await callTool(w, owner, tool, args);
      expect({ tool, ok: ok.json?.success }).toEqual({ tool, ok: true }); // control: the self call succeeds
    }
    for (const [tool, args] of calls) {
      const r = await callTool(w, observer, tool, args);
      expect({ tool, denied: r.json?.success === false }).toEqual({ tool, denied: true });
      expect(denialNames(r, "beta")).toBe(true);
    }
  });

  probe("J.gsp_search_memory_self_only", async () => {
    const w = world();
    const own = await callTool(w, w.creds.scoped, "gsp_search", { query: ALPHA, scope: "memory" });
    expect(own.json?.success).toBe(true);
    expect(JSON.stringify(own.json.results)).toContain(ALPHA); // control: the caller's own pattern is returned
    const peer = await callTool(w, w.creds.scoped, "gsp_search", { query: BETA, scope: "memory" });
    expect(peer.json?.success).toBe(true);
    expect(JSON.stringify(peer.json.results)).not.toContain(BETA); // the response echoes the query, so inspect results only
    const observer = await mint(w, "beta", "probe-j-search", ["gsp.read", "fleet.observe"]);
    const viaObserve = await callTool(w, observer, "gsp_search", { query: ALPHA, scope: "memory" });
    expect(viaObserve.json?.success).toBe(true);
    expect(JSON.stringify(viaObserve.json.results)).not.toContain(ALPHA); // fleet.observe does not widen memory search
  });

  // PR-K carry-in: a foreign reader gets an allowlist of fields, so a field the schema does not know is private by default.
  probe("J.foreign_state_allowlist", async () => {
    const w = world();
    const n = Date.now().toString(36);
    await emulatorDb().doc(stateDocPath(w, "alpha")).set({
      probeUnknown: `uk-${n}`, config: { knownQuirks: [`q-${n}`] }, decay: { decayLog: [`d-${n}`] },
    }, { merge: true }); // the schema strips unknown fields, so only a direct write adds one
    const mine = await callTool(w, w.creds.scoped, "state_get_program_state", { programId: "alpha" });
    for (const tag of [`uk-${n}`, `q-${n}`, `d-${n}`]) expect(mine.text).toContain(tag); // control: the program's own read sees all three
    const r = await callTool(w, w.creds.observer, "state_get_program_state", { programId: "alpha" });
    expect(r.json?.success).toBe(true);
    for (const tag of [`uk-${n}`, `q-${n}`, `d-${n}`]) expect(r.text).not.toContain(tag);
    const allowed = ["programId", "version", "sessionId", "lastUpdatedBy", "lastUpdatedAt", "baselines"];
    expect(Object.keys(r.json.state).filter((k) => !allowed.includes(k))).toEqual([]);
  });
});
