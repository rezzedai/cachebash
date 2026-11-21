import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { CASES, nextN, Ctx } from "./harness/cases";
import { denialNames, denied } from "./harness/judge";
import { knownOpen, probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { MCP_SERVER_DIR } from "./harness/server";
import type { ToolResult } from "./harness/client";
import type { World, WorldCredential } from "./harness/world";
import * as fs from "fs";
import * as path from "path";

/**
 * N (A-11): every denial must name the true principal in quotes, and a call that is refused must be refused
 * loudly. Collected from the T2 matrix: every tool whose T2 probe is not known-open must answer subject `beta`
 * (called as alpha) with a denial that contains "alpha". A silent empty result or an anonymous denial fails.
 */
describe("N denials name the principal", () => {
  probe("N.denials_name_the_principal", async () => {
    const w = world();
    const open = knownOpen();
    const bad: string[] = [];
    let checked = 0;
    for (const k of CASES) {
      if (`T2.${k.id}` in open) continue;
      const c: Ctx = { w, subject: "beta", n: nextN() };
      await k.prepare?.(c);
      const r = await callTool(w, w.creds[k.cred ?? "scoped"], k.tool, k.args(c));
      await k.cleanup?.(c);
      checked++;
      if (!denialNames(r, "alpha")) bad.push(`${k.id}: ${denied(r) ? "denial does not name the principal" : "silent (no denial)"}`);
    }
    expect(checked).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});

/**
 * N fleet paths (RD-5 PR-N, plan section 22 G and 22.1 items 1 and 6): a key holding exactly a table B set,
 * WITHOUT "*", must pass the capability gates for every tool the ledger shows that program calling.
 * `fixtures/fleet-tools-ledger.json` is the ledger measurement (tenants/7viFKV/ledger, 2026-11-06 to 11-20,
 * REST rows under short names, resolved through the alias map). The architect seat and the vector pods made 0 calls:
 * their fixture is every TOOL_CAPABILITIES tool whose capability is in the set (plan 22.1 item 6, "option 2" rule).
 * A failure here means table B is missing a capability and the narrow would deny that program: STOP, report to ISO.
 */
// The built server's own tables (the harness drives dist/index.js, so dist is the thing under test). Not imported from src:
// the probe config compiles no source outside this directory.
const dist = (f: string): any => require(path.join(MCP_SERVER_DIR, "dist", f));
const { DEFAULT_CAPABILITIES, TOOL_CAPABILITIES } = dist("middleware/capabilities.js") as {
  DEFAULT_CAPABILITIES: Record<string, string[]>; TOOL_CAPABILITIES: Record<string, string>;
};
const resolveToolAlias = (t: string): string => (dist("tools/tool-aliases.js") as { resolveToolAlias(n: string): string }).resolveToolAlias(t);

const TABLE_B: Record<string, string[]> = {
  dispatcher: ["dispatch.read", "dispatch.write", "pulse.read", "pulse.write", "relay.read", "relay.write", "signal.write", "state.read"],
  iso: [
    "audit.read", "dispatch.read", "dispatch.write", "fleet.read", "gsp.read", "gsp.write", "keys.read", "keys.write", "metrics.read",
    "programs.read", "programs.write", "pulse.read", "pulse.write", "relay.read", "relay.write", "signal.read", "signal.write",
    "sprint.read", "sprint.write", "state.read", "state.write", "webhooks.read", "webhooks.write",
  ],
  // measured minus keys.write, plus gsp.read, audit.read, metrics.read, signal.write, programs.read (16); fleet.observe and fleet.admin stay
  vector: [
    "dispatch.read", "dispatch.write", "fleet.read", "gsp.write", "keys.read", "pulse.read", "pulse.write", "relay.read", "relay.write",
    "state.read", "state.write", "gsp.read", "audit.read", "metrics.read", "signal.write", "programs.read",
  ],
  basher: [
    "dispatch.read", "dispatch.write", "fleet.read", "gsp.read", "gsp.write", "keys.read", "metrics.read", "pulse.read", "pulse.write",
    "relay.read", "relay.write", "state.read", "state.write",
  ],
};
const LITERAL_ONLY_HELD: Record<string, string[]> = { vector: ["fleet.observe", "fleet.admin"] };

/** Ledger tools that table B (as ruled, 22.1 item 6) deliberately leaves without a capability: the probe asserts the refusal. */
const RULED_OUT: Record<string, string[]> = {
  // "After the narrow, vector holds no keys.write. VECTOR approves mint and revoke calls and ISO runs them." (1 call in 14 days)
  vector: ["keys_revoke_key"],
};

const ledger = (program: string): string[] => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/fleet-tools-ledger.json"), "utf8")).programs[program] as Record<string, number>;
  return [...new Set(Object.keys(raw).map((t) => resolveToolAlias(t)))].sort();
};
const derived = (caps: readonly string[]): string[] =>
  Object.entries(TOOL_CAPABILITIES).filter(([, c]) => caps.includes(c)).map(([t]) => t).sort();

/** A call was refused for want of a capability: the gate text, a handler's "requires X capability" text, or a MISSING_CAPABILITY log line. */
const capabilityText = (r: ToolResult): boolean =>
  /insufficient capability|requires "?[a-z]+\.[a-z]+"? capability|explicit keys\.provision grant|cannot grant capabilities you do not hold/i.test(r.text);
const missingCapabilityLines = (w: World, from: number): any[] =>
  fs.readFileSync(w.serverLog).subarray(from).toString("utf8").split("\n")
    .filter((l) => l.includes('"event":"authz_denial"') && l.includes('"code":"MISSING_CAPABILITY"'))
    .map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } }).filter(Boolean);

/** Calls each tool as `cred` with empty arguments (a bad-request answer is fine: only the capability gates are asserted). */
async function capabilityRefusals(w: World, cred: WorldCredential, tools: string[]): Promise<string[]> {
  const refused: string[] = [];
  for (const tool of tools) {
    const from = fs.statSync(w.serverLog).size;
    const r = await callTool(w, cred, tool, {});
    if (capabilityText(r) || missingCapabilityLines(w, from).length > 0) refused.push(`${tool}: ${r.text.slice(0, 120)}`);
  }
  return refused;
}

const FLEET_PATHS: { id: string; program: string; caps: string[]; tools: string[]; ruledOut: string[] }[] = [
  { id: "N.fleet_path_dispatcher_tools", program: "dispatcher", caps: TABLE_B.dispatcher, tools: ledger("dispatcher"), ruledOut: [] },
  { id: "N.fleet_path_iso_tools", program: "iso", caps: TABLE_B.iso, tools: ledger("iso"), ruledOut: [] },
  {
    id: "N.fleet_path_vector_tools", program: "vector", caps: [...TABLE_B.vector, ...LITERAL_ONLY_HELD.vector],
    tools: ledger("vector").filter((t) => !RULED_OUT.vector.includes(t)), ruledOut: RULED_OUT.vector,
  },
  { id: "N.fleet_path_basher_tools", program: "basher", caps: TABLE_B.basher, tools: ledger("basher"), ruledOut: [] },
  // one council seat: DEFAULT_CAPABILITIES.architect (0 calls in the ledger: every tool its set maps)
  { id: "N.fleet_path_architect_tools", program: "alan", caps: [...DEFAULT_CAPABILITIES.architect], tools: derived(DEFAULT_CAPABILITIES.architect), ruledOut: [] },
  // one vector pod (vector_cerebro, vector_pluralsight, vector_wfp): vector's 16, no fleet.* names (0 calls in the ledger)
  { id: "N.fleet_path_vector_pod_tools", program: "vector_wfp", caps: TABLE_B.vector, tools: derived(TABLE_B.vector), ruledOut: [] },
];

describe("N fleet paths (table B, no wildcard)", () => {
  for (const p of FLEET_PATHS) {
    probe(p.id, async () => {
      const w = world();
      expect(p.tools.length).toBeGreaterThan(5);
      for (const t of p.tools) expect({ tool: t, mapped: t in TOOL_CAPABILITIES }).toEqual({ tool: t, mapped: true });
      const cred = await mint(w, p.program, `probe-${p.id}`, p.caps);
      expect(cred.capabilities).not.toContain("*");
      expect(await capabilityRefusals(w, cred, p.tools)).toEqual([]);
      for (const t of p.ruledOut) expect((await capabilityRefusals(w, cred, [t])).length).toBe(1);
    }, 240_000);

    test(`${p.id} control: the same set without the first tool's capability is refused that tool`, async () => {
      const w = world();
      const tool = p.tools[0];
      const need = TOOL_CAPABILITIES[tool];
      const cred = await mint(w, p.program, `probe-${p.id}-ctl`, p.caps.filter((c) => c !== need));
      expect((await capabilityRefusals(w, cred, [tool])).length).toBe(1);
    }, 60_000);
  }

  // 22.1 item 1 (C1): ISO's set covers what ISO mints. The mint also needs the literal keys.provision grant (ownerAuthz.isKeyProvisioner),
  // which is outside the 23 and is held beside them by any minting key.
  probe("N.fleet_path_iso_mints_builder", async () => {
    const w = world();
    const iso = await mint(w, "iso", "probe-n-iso-mint", [...TABLE_B.iso, "keys.provision"]);
    expect(iso.capabilities).not.toContain("*");
    const r = await callTool(w, iso, "keys_create_key", { programId: "builder", label: `n-mint-${nextN()}` }); // no capabilities: the builder default
    expect(r.json?.success).toBe(true);
    expect(typeof r.json?.keyHash).toBe("string");
    expect(r.json?.capabilities).toEqual(DEFAULT_CAPABILITIES.builder);
  });

  test("N.fleet_path_iso_mints_builder control: a set missing one builder capability is refused the mint", async () => {
    const w = world();
    const iso = await mint(w, "iso", "probe-n-iso-mint-ctl", [...TABLE_B.iso.filter((c) => c !== "programs.write"), "keys.provision"]);
    const r = await callTool(w, iso, "keys_create_key", { programId: "builder", label: `n-mint-ctl-${nextN()}` });
    expect(r.json?.success).toBe(false);
    expect(r.text).toContain("programs.write");
  });
});
