import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { CASES, nextN, Ctx } from "./harness/cases";
import { knownOpen } from "./harness/registry";
import * as fs from "fs";
import { emulatorDb } from "./harness/emulator";
import { marker } from "./harness/data";
import { denialNames, sees } from "./harness/judge";
import type { World, WorldCredential } from "./harness/world";

/**
 * L (RD-5 PR-L, plan section 20 G): the live fleet paths. Each caller below exists in grid today (spawner, task-poll,
 * fleet-watch, reconciliation, the hooks, the orchestrator scripts). Every probe passes on unmodified main and after every
 * PR-L commit; each patch under mutations/ drops the grant the path survives through, and the probe must go red.
 */

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
      await k.cleanup?.(c);
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

  // L-D1: fleet.observe reads a foreign program's sessions; a key without it is refused.
  probe("L.observer_reads_foreign_sessions", async () => {
    const w = world();
    const r = await callTool(w, w.creds.observer, "pulse_list_sessions", { programId: "alpha", includeArchived: true, limit: 50 });
    expect(sees(r, marker("A", "alpha"))).toBe(true);
  });
  test("L.observer_reads_foreign_sessions control: scoped is refused the same read", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "pulse_list_sessions", { programId: "beta", includeArchived: true, limit: 50 });
    expect(denialNames(r, "alpha")).toBe(true);
  });

  // L-D1 option 1: no programId means the principal's own sessions unless privileged.
  probe("L.list_sessions_default_self", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "pulse_list_sessions", { includeArchived: true, limit: 50 });
    expect(sees(r, marker("A", "alpha"))).toBe(true);
    expect(r.text).not.toContain(marker("A", "beta"));
  });
  test("L.list_sessions_default_self control: a minted dispatcher sees both programs", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-default", ["*"]);
    const r = await callTool(w, dispatcher, "pulse_list_sessions", { includeArchived: true, limit: 50 });
    expect(r.text).toContain(marker("A", "alpha"));
    expect(r.text).toContain(marker("A", "beta"));
  });

  // 20.1 item 2 (H4): an empty or missing principal is never privileged. A key document with no programId must not write a session it does not own.
  probe("L.empty_principal_not_privileged", async () => {
    const w = world();
    const sessionId = await freshSession(w, "beta");
    const empty = await mint(w, "", "probe-l-empty-principal", ["*"]);
    const r = await callTool(w, empty, "pulse_update_session", { sessionId, status: "l-empty-principal", lastHeartbeat: true });
    expect(r.json?.success).not.toBe(true);
    const list = await callTool(w, empty, "pulse_list_sessions", { programId: "beta", includeArchived: true, limit: 50 });
    expect(list.text).not.toContain(marker("A", "beta"));
  });
  test("L.empty_principal_not_privileged control: a minted dispatcher updates the same session", async () => {
    const w = world();
    const sessionId = await freshSession(w, "beta");
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-empty-ctl", ["*"]);
    const r = await callTool(w, dispatcher, "pulse_update_session", { sessionId, status: "l-empty-ctl", lastHeartbeat: true });
    expect(r.json?.success).toBe(true);
  });

  /** A task sent by `source` to `target`, created as the mobile seeder (the only principal that may name another source). */
  const sentTask = async (w: World, source: string, target: string): Promise<string> => {
    const t = await callTool(w, w.stateSeeders.A, "dispatch_create_task", { title: `l-act-${nextN()}`, target, source, instructions: "l-act" });
    if (!t.json?.taskId) throw new Error(`task setup failed: ${t.text.slice(0, 300)}`);
    return t.json.taskId as string;
  };

  // L-D2: acting on a task needs a party to it, the iso or dispatcher override, or fleet.admin.
  probe("L.abort_foreign_denied", async () => {
    const w = world();
    const taskId = await sentTask(w, "beta", "beta");
    const r = await callTool(w, w.creds.scoped, "dispatch_abort_task", { taskId, reason: "l" });
    expect(denialNames(r, "alpha")).toBe(true);
    const row = await callTool(w, w.seeders.A, "dispatch_get_task_by_id", { taskId });
    expect(row.json?.task?.status).toBe("created");
  });
  test("L.abort_foreign_denied control: the sender aborts its own task", async () => {
    const w = world();
    const taskId = await sentTask(w, "alpha", "beta");
    const beta = await mint(w, "beta", "probe-l-beta-claim", ["*"]);
    expect((await callTool(w, beta, "dispatch_claim_task", { taskId })).json?.success).toBe(true); // abort needs an active task
    const r = await callTool(w, w.creds.scoped, "dispatch_abort_task", { taskId, reason: "l" });
    expect(r.json?.success).toBe(true);
  });

  probe("L.approve_foreign_denied", async () => {
    const w = world();
    const taskId = await sentTask(w, "beta", "beta");
    const r = await callTool(w, w.creds.scoped, "dispatch_approve_task", { taskId });
    expect(denialNames(r, "alpha")).toBe(true);
  });
  test("L.approve_foreign_denied control: a party gets past the check to the status rule", async () => {
    const w = world();
    const taskId = await sentTask(w, "alpha", "beta");
    const r = await callTool(w, w.creds.scoped, "dispatch_approve_task", { taskId });
    expect(r.text).not.toMatch(/access denied/i);
    expect(r.text).toMatch(/cannot be approved|not awaiting/);
  });

  probe("L.escalate_foreign_denied", async () => {
    const w = world();
    const taskId = await sentTask(w, "beta", "beta");
    const r = await callTool(w, w.creds.scoped, "dispatch_escalate_task", { taskId, escalateTo: "beta", reason: "l" });
    expect(denialNames(r, "alpha")).toBe(true);
  });
  test("L.escalate_foreign_denied control: the sender escalates its own task", async () => {
    const w = world();
    const taskId = await sentTask(w, "alpha", "beta");
    const r = await callTool(w, w.creds.scoped, "dispatch_escalate_task", { taskId, escalateTo: "beta", reason: "l" });
    expect(r.json?.success).toBe(true);
  });

  const fleetAdmin = (w: World) => mint(w, "beta", "probe-l-fleet-admin", ["*", "fleet.admin"]);
  const programDoc = async (w: World, p: string) => (await emulatorDb().doc(`tenants/${w.tenants.A}/programs/${p}`).get()).data() ?? {};

  // L-D3: a foreign quarantine or release needs the literal fleet.admin capability.
  probe("L.quarantine_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "dispatch_quarantine_program", { programId: "beta", reason: "l" });
    expect(denialNames(r, "alpha")).toBe(true);
    expect((await programDoc(w, "beta")).quarantined).not.toBe(true);
  });
  test("L.quarantine_foreign_denied control: a fleet.admin key quarantines, then releases", async () => {
    const w = world();
    const q = await callTool(w, await fleetAdmin(w), "dispatch_quarantine_program", { programId: "alpha", reason: "l" });
    expect(q.json?.success).toBe(true);
    const u = await callTool(w, await fleetAdmin(w), "dispatch_unquarantine_program", { programId: "alpha" });
    expect(u.json?.success).toBe(true);
  });

  probe("L.unquarantine_foreign_denied", async () => {
    const w = world();
    const q = await callTool(w, await fleetAdmin(w), "dispatch_quarantine_program", { programId: "beta", reason: "l" });
    expect(q.json?.success).toBe(true);
    try {
      const r = await callTool(w, w.creds.scoped, "dispatch_unquarantine_program", { programId: "beta" });
      expect(denialNames(r, "alpha")).toBe(true);
      expect((await programDoc(w, "beta")).quarantined).toBe(true);
    } finally {
      await callTool(w, await fleetAdmin(w), "dispatch_unquarantine_program", { programId: "beta" });
    }
  });
  test("L.unquarantine_foreign_denied control: the fleet.admin key releases", async () => {
    const w = world();
    await callTool(w, await fleetAdmin(w), "dispatch_quarantine_program", { programId: "beta", reason: "l" });
    const u = await callTool(w, await fleetAdmin(w), "dispatch_unquarantine_program", { programId: "beta" });
    expect(u.json?.success).toBe(true);
  });

  // row 14: a task is read by a party to it, TASKS_ALL_PRINCIPALS or fleet.observe.
  probe("L.task_by_id_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "dispatch_get_task_by_id", { taskId: w.seed.A.beta.taskId });
    expect(denialNames(r, "alpha")).toBe(true);
    expect(r.text).not.toContain(marker("A", "beta"));
  });
  test("L.task_by_id_foreign_denied control: the target and an observer read the task", async () => {
    const w = world();
    const own = await callTool(w, w.creds.scoped, "dispatch_get_task_by_id", { taskId: w.seed.A.alpha.taskId });
    expect(own.text).toContain(marker("A", "alpha"));
    const observed = await callTool(w, w.creds.observer, "dispatch_get_task_by_id", { taskId: w.seed.A.alpha.taskId });
    expect(observed.text).toContain(marker("A", "alpha"));
  });

  // row 16 (K-D1): the dispatcher claims for a builder; the builder completes and records telemetry. Another program may not.
  const completedByDelegation = async (w: World): Promise<{ taskId: string; beta: WorldCredential }> => {
    const dispatcher = await mint(w, "dispatcher", "probe-l-dispatcher-telemetry", ["*"]);
    const beta = await mint(w, "beta", "probe-l-beta-telemetry", ["*"]);
    const made = await callTool(w, w.stateSeeders.A, "dispatch_create_task", { title: `l-tel-${nextN()}`, target: "beta", source: "legacy", instructions: "l-tel" });
    const taskId = made.json?.taskId as string;
    expect((await callTool(w, dispatcher, "dispatch_claim_task", { taskId, sessionId: "beta" })).json?.success).toBe(true);
    const done = await callTool(w, beta, "dispatch_complete_task", { taskId, completed_status: "SUCCESS", model: "probe", provider: "probe", result: "l" });
    expect(done.json?.success).toBe(true);
    return { taskId, beta };
  };
  probe("L.telemetry_delegated_claim", async () => {
    const w = world();
    const { taskId, beta } = await completedByDelegation(w);
    const r = await callTool(w, beta, "dispatch_record_task_telemetry", { taskId, tokens_in: 1, tokens_out: 2, cost_usd: 0.01 });
    expect(r.json?.success).toBe(true);
  });
  test("L.telemetry_delegated_claim control: another program is refused", async () => {
    const w = world();
    const { taskId } = await completedByDelegation(w);
    const r = await callTool(w, w.creds.scoped, "dispatch_record_task_telemetry", { taskId, tokens_in: 1, tokens_out: 2, cost_usd: 0.01 });
    expect(denialNames(r, "alpha")).toBe(true);
  });

  // rows 19, 20: a schedule is read by its creator, its target, the override principals or fleet.observe; managed by its creator, the override principals or fleet.admin.
  const ownSchedule = async (w: World): Promise<string> => {
    const made = await callTool(w, w.creds.scoped, "schedule_create", { name: `l-sch-${nextN()}`, target: "alpha", cron: "0 0 1 1 *", taskTemplate: { title: "l-sch" } });
    if (!made.json?.scheduleId) throw new Error(`schedule setup failed: ${made.text.slice(0, 300)}`);
    return made.json.scheduleId as string;
  };
  probe("L.schedule_get_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "schedule_get", { scheduleId: w.seed.A.beta.scheduleId });
    expect(denialNames(r, "alpha")).toBe(true);
    expect(r.text).not.toContain(marker("A", "beta"));
  });
  test("L.schedule_get_foreign_denied control: the creator reads its own schedule", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "schedule_get", { scheduleId: await ownSchedule(w) });
    expect(r.json?.success).toBe(true);
  });
  probe("L.schedule_delete_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "schedule_delete", { scheduleId: w.seed.A.beta.scheduleId });
    expect(denialNames(r, "alpha")).toBe(true);
    const still = await callTool(w, w.seeders.A, "schedule_get", { scheduleId: w.seed.A.beta.scheduleId });
    expect(still.json?.success).toBe(true);
  });
  test("L.schedule_delete_foreign_denied control: the creator deletes its own schedule", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "schedule_delete", { scheduleId: await ownSchedule(w) });
    expect(r.json?.success).toBe(true);
  });
});
