import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { writeKey } from "./harness/seed";
import { CASES, nextN, Ctx } from "./harness/cases";
import { knownOpen } from "./harness/registry";
import * as fs from "fs";
import { marker } from "./harness/data";
import type { World, WorldCredential } from "./harness/world";

/**
 * L (RD-5 PR-L, plan section 20 G): the live fleet paths. Each caller below exists in grid today (spawner, task-poll,
 * fleet-watch, reconciliation, the hooks, the orchestrator scripts). Every probe passes on unmodified main and after every
 * PR-L commit; each patch under mutations/ drops the grant the path survives through, and the probe must go red.
 */

/** A tenant-A credential of `programId` holding exactly `capabilities`. */
async function mint(w: World, programId: string, label: string, capabilities: string[]): Promise<WorldCredential> {
  const { key, keyHash } = await writeKey(w.tenants.A, programId, label, capabilities);
  return { name: "scoped", tenant: "A", tenantUid: w.tenants.A, programId, capabilities, key, keyHash };
}

/** A session of `program`, created as the mobile seeder. */
async function freshSession(w: World, program: string): Promise<string> {
  const sessionId = `${program}-u${nextN()}`;
  const r = await callTool(w, w.stateSeeders.A, "pulse_create_session", { name: `l-${sessionId}`, sessionId, programId: program, status: "l-fresh" });
  if (r.json?.success !== true) throw new Error(`session setup failed: ${r.text.slice(0, 300)}`);
  return sessionId;
}

/** The `authz_denial` lines the server wrote after byte offset `from`. */
const denialLines = (w: World, from: number): any[] =>
  fs.readFileSync(w.serverLog).subarray(from).toString("utf8").split("\n")
    .filter((l) => l.includes('"event":"authz_denial"'))
    .map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } })
    .filter(Boolean);
const logSize = (w: World): number => fs.statSync(w.serverLog).size;

describe("L fleet paths", () => {
  // grid dispatcher/src/spawner.ts:670 create_session `<prog>-g<n>`
  probe("L.fleet_path_dispatcher_creates_session", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-create", ["*"]);
    const id = `beta-g${nextN()}`;
    const r = await callTool(w, dispatcher, "pulse_create_session", { name: `l-${id}`, sessionId: id, programId: "beta", status: "l-spawn" });
    expect(r.json?.success).toBe(true);
    expect(r.json?.sessionId).toBe(id);
  });

  // task-poll.ts:581, fleet-watch.ts:608, reconciliation.ts:188-300 update_session on a builder's session
  probe("L.fleet_path_dispatcher_updates_session", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-update", ["*"]);
    const sessionId = await freshSession(w, "beta"); // a fresh row: the seeded sessions keep their marker for the other probes
    const r = await callTool(w, dispatcher, "pulse_update_session", { sessionId, status: "l-dispatcher-update", lastHeartbeat: true });
    expect(r.json?.success).toBe(true);
  });

  // task-poll.ts:575, fleet-watch.ts:402, reconciliation.ts:130, recycle-manager.ts:876 list_sessions
  probe("L.fleet_path_dispatcher_lists_sessions", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-list", ["*"]);
    const foreign = await callTool(w, dispatcher, "pulse_list_sessions", { programId: "beta", includeArchived: true, limit: 50 });
    expect(foreign.json?.success).not.toBe(false);
    expect(foreign.text).toContain(marker("A", "beta"));
    const all = await callTool(w, dispatcher, "pulse_list_sessions", { includeArchived: true, limit: 50 });
    expect(all.text).toContain(marker("A", "alpha"));
    expect(all.text).toContain(marker("A", "beta"));
  });

  // spawner.ts:417, fleet-watch.ts:2470 get_task_by_id on a task the dispatcher neither sent nor owns
  probe("L.fleet_path_dispatcher_reads_task", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-task", ["*"]);
    const r = await callTool(w, dispatcher, "dispatch_get_task_by_id", { taskId: w.seed.A.beta.taskId });
    expect(r.json?.success).toBe(true);
    expect(r.text).toContain(marker("A", "beta"));
  });

  // CLAUDE.md:24 and recognizer-host host_common.py:175 get_fleet_health as vector and as iso: the capability half decides
  probe("L.fleet_path_observer_fleet_health", async () => {
    const w = world();
    const vector = await mint(w, "vector", "probe-l-vector-health", ["*", "fleet.observe"]);
    const iso = await mint(w, "iso", "probe-l-iso-health", ["*"]);
    for (const cred of [vector, iso]) {
      const r = await callTool(w, cred, "pulse_get_fleet_health", { detail: "summary" });
      expect(r.json?.success).not.toBe(false);
      expect(r.isError).toBe(false);
    }
  });

  // orchestrator-followup-enforcer.sh:180 and the refuter agents: iso and vector read the task they sent
  probe("L.fleet_path_orchestrator_reads_sent_task", async () => {
    const w = world();
    for (const program of ["iso", "vector"]) {
      const cred = await mint(w, program, `probe-l-${program}-sent`, ["*"]);
      const n = nextN();
      const made = await callTool(w, cred, "dispatch_create_task", { title: `l-sent-${n}`, target: "beta", source: program, instructions: `l-sent-i-${n}` });
      expect(made.json?.taskId).toBeTruthy();
      const r = await callTool(w, cred, "dispatch_get_task_by_id", { taskId: made.json.taskId });
      expect(r.json?.success).toBe(true);
      expect(r.text).toContain(`l-sent-i-${n}`);
    }
  });

  // cachebash-context-reporter.sh:75, rotation-enforcer.sh:75, tools/cb:190: each program updates its own session
  probe("L.fleet_path_self_update_session", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-alpha-self", ["*"]);
    const sessionId = await freshSession(w, "alpha");
    const r = await callTool(w, alpha, "pulse_update_session", { sessionId, status: "l-self-update", contextUsedPct: 41, lastHeartbeat: true });
    expect(r.json?.success).toBe(true);
  });

  test("L.fleet_path_self_update_session control: a program is refused another program's session", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-alpha-ctl", ["*"]);
    const sessionId = await freshSession(w, "beta");
    const r = await callTool(w, alpha, "pulse_update_session", { sessionId, status: "l-ctl", lastHeartbeat: true });
    expect(r.json?.success).toBe(false);
  });

  // D (VECTOR peOCDVcF): every refusal writes one authz_denial line, so the server log can count them.
  probe("L.denials_are_logged", async () => {
    const w = world();
    const open = knownOpen();
    const bad: string[] = [];
    let checked = 0;
    for (const k of CASES) {
      if (`T2.${k.id}` in open) continue;
      const c: Ctx = { w, subject: "beta", n: nextN() };
      await k.prepare?.(c);
      const from = logSize(w);
      await callTool(w, w.creds[k.cred ?? "scoped"], k.tool, k.args(c));
      checked++;
      const lines = denialLines(w, from);
      const mine = lines.filter((d) => d.principal === "alpha" && d.tool === k.tool && d.subject === "beta" && typeof d.code === "string");
      if (mine.length < 1) bad.push(`${k.id}: ${lines.length} authz_denial lines, none naming alpha, ${k.tool}, beta`);
    }
    expect(checked).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  test("L.denials_are_logged control: an own-subject call writes no denial line", async () => {
    const w = world();
    const from = logSize(w);
    const r = await callTool(w, w.creds.scoped, "state_get_program_state", { programId: "alpha" });
    expect(r.json?.success).not.toBe(false);
    expect(denialLines(w, from)).toEqual([]);
  });
});
