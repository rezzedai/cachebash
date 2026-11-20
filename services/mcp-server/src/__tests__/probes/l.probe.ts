import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { CASES, nextN, Ctx } from "./harness/cases";
import { knownOpen } from "./harness/registry";
import * as fs from "fs";
import { emulatorDb } from "./harness/emulator";
import * as path from "path";
import { MCP_SERVER_DIR } from "./harness/server";
import { Timestamp } from "firebase-admin/firestore";
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

// the backfill under test is the built one, so a mutation-control run exercises the patched copy
const { runAskedByBackfill } = require(path.join(process.env.PROBE_SERVER_DIR || MCP_SERVER_DIR, "dist/auth/rd5/askedByBackfill.js")) as {
  runAskedByBackfill: (db: unknown, o: { tenantUid: string; apply: boolean }) => Promise<{ counts: { written: number }; lines: string[] }>;
};

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

  // orchestrator-watch.service (recognizer-vm, key c517857c): reads only fleet health with fleet.read + fleet.observe; a refusal silences the VM alarm
  probe("L.fleet_path_orchestrator_watch_fleet_health", async () => {
    const w = world();
    const watch = await mint(w, "orchestrator-watch", "probe-l-orch-watch-health", ["fleet.read", "fleet.observe"]);
    const r = await callTool(w, watch, "pulse_get_fleet_health", { detail: "summary" });
    expect(r.isError).toBe(false);
    expect(r.json?.success).not.toBe(false);
    expect(Array.isArray(r.json?.programs) && r.json.programs.length > 0).toBe(true);
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

  // table A row 2: a program creating its own env-suffixed session with no programId stores programId = principal (tensor, 11-04)
  probe("L.self_create_session_env_suffix", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-alpha-selfcreate", ["*"]);
    const id = `alpha-g${nextN()}.t1`;
    const r = await callTool(w, alpha, "pulse_create_session", { name: `l-${id}`, sessionId: id, status: "l-self-create" });
    expect(r.json?.success).toBe(true);
    const list = await callTool(w, alpha, "pulse_list_sessions", { includeArchived: true, limit: 50 });
    const row = (list.json?.sessions ?? []).find((s: any) => s.sessionId === id || s.id === id);
    expect(row?.programId).toBe("alpha");
  });

  test("L.self_create_session_env_suffix control: alpha creating a beta-prefixed session is refused", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-alpha-selfcreate-ctl", ["*"]);
    const id = `beta-g${nextN()}`;
    const r = await callTool(w, alpha, "pulse_create_session", { name: `l-${id}`, sessionId: id, status: "l-self-create-ctl" });
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

  // row 21: iso keeps the registry grant; a program key updates only its own entry.
  probe("L.registry_iso_grant", async () => {
    const w = world();
    const iso = await mint(w, "iso", "probe-l-iso-registry", ["*"]);
    const tag = `l-reg-${nextN()}`;
    const r = await callTool(w, iso, "programs_update_program", { programId: "beta", displayName: tag });
    expect(r.json?.success).toBe(true);
  });
  test("L.registry_iso_grant control: a program key is refused another program's entry", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "programs_update_program", { programId: "beta", displayName: `l-reg-${nextN()}` });
    expect(denialNames(r, "alpha")).toBe(true);
  });

  // L-D10: a fleet.admin key merges into its own tenant only.
  probe("L.merge_cross_tenant_denied", async () => {
    const w = world();
    const admin = await mint(w, "beta", "probe-l-merge-admin", ["*", "fleet.admin"]);
    const email = `l-merge-${nextN()}@example.invalid`;
    const r = await callTool(w, admin, "admin_merge_accounts", { email, canonicalUid: w.tenants.B, alternateUid: "l-merge-alt" });
    expect(denialNames(r, "beta")).toBe(true);
    expect((await emulatorDb().collection("canonical_accounts").where("email", "==", email).get()).size).toBe(0);
  });
  test("L.merge_cross_tenant_denied control: the same key merges into its own tenant", async () => {
    const w = world();
    const admin = await mint(w, "beta", "probe-l-merge-admin-ctl", ["*", "fleet.admin"]);
    const email = `l-merge-ok-${nextN()}@example.invalid`;
    const r = await callTool(w, admin, "admin_merge_accounts", { email, canonicalUid: w.tenants.A, alternateUid: "l-merge-alt2" });
    expect(r.json?.success).toBe(true);
  });

  // row 22: audit reads follow L-D1. A foreign programId needs fleet.observe; no programId means the principal's own entries.
  probe("L.audit_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.wildcard, "audit_get_audit", { programId: "beta", limit: 5 });
    expect(denialNames(r, "alpha")).toBe(true);
  });
  test("L.audit_foreign_denied control: an observer reads a foreign program, and the default is the caller's own", async () => {
    const w = world();
    const obs = await mint(w, "vector", "probe-l-audit-observer", ["*", "fleet.observe"]);
    const foreign = await callTool(w, obs, "audit_get_audit", { programId: "beta", limit: 5 });
    expect(foreign.json?.success).toBe(true);
    const own = await callTool(w, w.creds.wildcard, "audit_get_audit", { limit: 5 });
    expect(own.json?.success).toBe(true);
  });

  // row 23: program health follows L-D1; the five other metrics tools lose the isAdmin disjunct (it was unreachable, H2) and name the caller in the denial (H9).
  probe("L.metrics_health_foreign_denied", async () => {
    const w = world();
    const r = await callTool(w, w.creds.wildcard, "metrics_get_program_health", { programId: "beta" });
    expect(denialNames(r, "alpha")).toBe(true);
  });
  test("L.metrics_health_foreign_denied control: an observer reads a foreign program, the default is the caller's own", async () => {
    const w = world();
    const obs = await mint(w, "vector", "probe-l-health-observer", ["*", "fleet.observe"]);
    expect((await callTool(w, obs, "metrics_get_program_health", { programId: "beta" })).json?.success).toBe(true);
    expect((await callTool(w, w.creds.wildcard, "metrics_get_program_health", {})).json?.success).toBe(true);
  });

  // rows 24, 26: the trace tools follow TRACE_ADMIN_PRINCIPALS (mobile, dispatcher). A bare "*" key named legacy no longer passes.
  probe("L.trace_names_rebound", async () => {
    const w = world();
    const legacy = await mint(w, "legacy", "probe-l-trace-legacy", ["*"]);
    const one = await callTool(w, legacy, "trace_query_trace", { traceId: "l-trace" });
    expect(denialNames(one, "legacy")).toBe(true);
    const many = await callTool(w, legacy, "trace_query_traces", {});
    expect(denialNames(many, "legacy")).toBe(true);
  });
  test("L.trace_names_rebound control: a minted dispatcher key reads both", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-trace-dispatcher", ["*"]);
    expect((await callTool(w, dispatcher, "trace_query_trace", { traceId: "l-trace" })).json?.success).toBe(true);
    expect((await callTool(w, dispatcher, "trace_query_traces", {})).json?.success).toBe(true);
  });

  // row 30 (K-D3): dead letters follow RELAY_ADMIN_PRINCIPALS (mobile, dispatcher). A bare "*" key named legacy no longer passes.
  probe("L.dead_letters_names_rebound", async () => {
    const w = world();
    const legacy = await mint(w, "legacy", "probe-l-dead-legacy", ["*"]);
    const r = await callTool(w, legacy, "relay_get_dead_letters", {});
    expect(denialNames(r, "legacy")).toBe(true);
  });
  test("L.dead_letters_names_rebound control: a minted dispatcher key reads the queue", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-l-dead-dispatcher", ["*"]);
    expect((await callTool(w, dispatcher, "relay_get_dead_letters", {})).json?.success).toBe(true);
  });

  // row 32 (L-D8): a question response is read by its asker, mobile or a fleet.observe holder.
  const ask = async (w: World, cred: WorldCredential): Promise<string> => {
    const r = await callTool(w, cred, "signal_ask_question", { question: `l-q-${nextN()}`, encrypt: false });
    if (!r.json?.questionId) throw new Error(`ask failed: ${r.text.slice(0, 300)}`);
    return r.json.questionId as string;
  };
  probe("L.signal_response_foreign_denied", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-ask-alpha", ["*"]);
    const beta = await mint(w, "beta", "probe-l-ask-beta", ["*"]);
    const questionId = await ask(w, alpha);
    const r = await callTool(w, beta, "signal_get_response", { questionId });
    expect(denialNames(r, "beta")).toBe(true);
  });
  test("L.signal_response_foreign_denied control: the asker and mobile read it", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-ask-alpha2", ["*"]);
    const questionId = await ask(w, alpha);
    expect((await callTool(w, alpha, "signal_get_response", { questionId })).json?.success).toBe(true);
    expect((await callTool(w, w.stateSeeders.A, "signal_get_response", { questionId })).json?.success).toBe(true);
  });

  // 20.1 item 3: a question with no askedBy fails closed, and the backfill (askedBy from source) restores the owner's read.
  const unattributed = async (w: World, source: string): Promise<string> => {
    const ref = await emulatorDb().collection(`tenants/${w.tenants.A}/tasks`).add({
      type: "question", title: "l-old", instructions: "", source, target: "user", status: "created", encrypted: false, archived: false,
      question: { content: "l-old", options: null, context: null, response: null, answeredAt: null }, createdAt: Timestamp.now(),
    });
    return ref.id;
  };
  probe("L.signal_unattributed_fail_closed", async () => {
    const w = world();
    const questionId = await unattributed(w, "beta");
    const beta = await mint(w, "beta", "probe-l-unattr-beta", ["*"]);
    const r = await callTool(w, beta, "signal_get_response", { questionId });
    expect(denialNames(r, "beta")).toBe(true);
  });
  test("L.signal_unattributed_fail_closed control: mobile and iso read it", async () => {
    const w = world();
    const questionId = await unattributed(w, "beta");
    const iso = await mint(w, "iso", "probe-l-unattr-iso", ["*"]);
    expect((await callTool(w, w.stateSeeders.A, "signal_get_response", { questionId })).json?.success).toBe(true);
    expect((await callTool(w, iso, "signal_get_response", { questionId })).json?.success).toBe(true);
  });
  probe("L.signal_backfill_sets_asked_by", async () => {
    const w = world();
    const questionId = await unattributed(w, "beta");
    const skipped = await unattributed(w, "program");
    const dry = await runAskedByBackfill(emulatorDb() as never, { tenantUid: w.tenants.A, apply: false });
    expect(dry.counts.written).toBe(0);
    expect((await emulatorDb().doc(`tenants/${w.tenants.A}/tasks/${questionId}`).get()).data()?.askedBy).toBeUndefined();
    const applied = await runAskedByBackfill(emulatorDb() as never, { tenantUid: w.tenants.A, apply: true });
    expect(applied.counts.written).toBeGreaterThanOrEqual(1);
    expect((await emulatorDb().doc(`tenants/${w.tenants.A}/tasks/${questionId}`).get()).data()?.askedBy).toBe("beta");
    expect((await emulatorDb().doc(`tenants/${w.tenants.A}/tasks/${skipped}`).get()).data()?.askedBy).toBeUndefined();
    const beta = await mint(w, "beta", "probe-l-backfill-beta", ["*"]);
    expect((await callTool(w, beta, "signal_get_response", { questionId })).json?.success).toBe(true);
  });
  test("L.signal_backfill_sets_asked_by control: a dry run reports and writes nothing", async () => {
    const w = world();
    const questionId = await unattributed(w, "alpha");
    const dry = await runAskedByBackfill(emulatorDb() as never, { tenantUid: w.tenants.A, apply: false });
    expect(dry.lines.join("\n")).toContain("DRY RUN");
    expect((await emulatorDb().doc(`tenants/${w.tenants.A}/tasks/${questionId}`).get()).data()?.askedBy).toBeUndefined();
  });

  // row 33 (L-D7 option 2): a sprint is written by its creator, the override principals, fleet.admin or mobile; read adds fleet.observe and the dispatcher.
  const newSprint = async (w: World, cred: WorldCredential): Promise<string> => {
    const r = await callTool(w, cred, "sprint_create_sprint", { projectName: `l-${nextN()}`, branch: "l", stories: [{ id: "s1", title: "l-story" }] });
    const id = (r.json?.sprintId ?? r.json?.id) as string | undefined;
    if (!id) throw new Error(`sprint setup failed: ${r.text.slice(0, 300)}`);
    return id;
  };
  probe("L.sprint_write_foreign_denied", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-sprint-alpha", ["*"]);
    const beta = await mint(w, "beta", "probe-l-sprint-beta", ["*"]);
    const sprintId = await newSprint(w, alpha);
    const add = await callTool(w, beta, "sprint_add_story_to_sprint", { sprintId, story: { id: "s2", title: "l-foreign" } });
    expect(denialNames(add, "beta")).toBe(true);
    const done = await callTool(w, beta, "sprint_complete_sprint", { sprintId });
    expect(denialNames(done, "beta")).toBe(true);
    const upd = await callTool(w, beta, "sprint_update_sprint_story", { sprintId, storyId: "s1", status: "active" });
    expect(denialNames(upd, "beta")).toBe(true);
    const read = await callTool(w, beta, "sprint_get_sprint", { sprintId });
    expect(denialNames(read, "beta")).toBe(true);
  });
  test("L.sprint_write_foreign_denied control: the creator writes, and an observer reads", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-sprint-alpha2", ["*"]);
    const sprintId = await newSprint(w, alpha);
    expect((await callTool(w, alpha, "sprint_add_story_to_sprint", { sprintId, story: { id: "s2", title: "l-own" } })).json?.success).toBe(true);
    const obs = await mint(w, "vector", "probe-l-sprint-observer", ["*", "fleet.observe"]);
    expect((await callTool(w, obs, "sprint_get_sprint", { sprintId })).json?.success).toBe(true);
  });

  const unattributedSprint = async (w: World): Promise<string> => {
    const ref = await emulatorDb().collection(`tenants/${w.tenants.A}/tasks`).add({
      type: "sprint", title: "Sprint: l-old", instructions: "", source: "orchestrator", target: null, status: "active", encrypted: false, archived: false,
      sprint: { projectName: "l-old", branch: "l", config: {} }, createdAt: Timestamp.now(),
    });
    return ref.id;
  };
  probe("L.sprint_unattributed_fail_closed", async () => {
    const w = world();
    const sprintId = await unattributedSprint(w);
    const alpha = await mint(w, "alpha", "probe-l-sprint-unattr", ["*"]);
    const r = await callTool(w, alpha, "sprint_get_sprint", { sprintId });
    expect(denialNames(r, "alpha")).toBe(true);
    const w2 = await callTool(w, alpha, "sprint_complete_sprint", { sprintId });
    expect(denialNames(w2, "alpha")).toBe(true);
  });
  test("L.sprint_unattributed_fail_closed control: mobile and iso act on it", async () => {
    const w = world();
    const sprintId = await unattributedSprint(w);
    const iso = await mint(w, "iso", "probe-l-sprint-iso", ["*"]);
    expect((await callTool(w, w.stateSeeders.A, "sprint_get_sprint", { sprintId })).json?.success).toBe(true);
    expect((await callTool(w, iso, "sprint_get_sprint", { sprintId })).json?.success).toBe(true);
  });

  // row 35 (L-D6 option 1): policy writes need literal fleet.admin; reads stay open.
  const policyArgs = (id: string) => ({
    id, name: `l-${id}`, description: "l policy", tier: "operational", enforcement: "warn", severity: "P2",
    rule: { type: "pattern", pattern: "l-never-matches-xyz" }, scope: {}, enabled: true,
  });
  probe("L.policy_write_needs_admin", async () => {
    const w = world();
    const id = `l-pol-${nextN()}`;
    const r = await callTool(w, w.creds.scoped, "policy_create", policyArgs(id));
    expect(denialNames(r, "alpha")).toBe(true);
    const got = await callTool(w, w.seeders.A, "policy_get", { policyId: id });
    expect(got.json?.found ?? got.json?.success).not.toBe(true);
  });
  test("L.policy_write_needs_admin control: a fleet.admin key creates and deletes, and any key reads", async () => {
    const w = world();
    const admin = await mint(w, "beta", "probe-l-policy-admin", ["*", "fleet.admin"]);
    const id = `l-pol-ok-${nextN()}`;
    const made = await callTool(w, admin, "policy_create", policyArgs(id));
    expect(made.json?.success).toBe(true);
    expect((await callTool(w, w.creds.scoped, "policy_get", { policyId: id })).json?.success).toBe(true);
    expect((await callTool(w, admin, "policy_delete", { policyId: id })).json?.success).toBe(true);
  });

  // row 36: the registrant deletes its own webhook; a foreign webhook needs literal fleet.admin.
  const registerHook = async (w: World, cred: WorldCredential): Promise<string> => {
    const r = await callTool(w, cred, "webhook_register", { events: ["task.created"], callbackUrl: `https://example.invalid/l-${nextN()}` });
    const id = (r.json?.webhookId ?? r.json?.id) as string | undefined;
    if (!id) throw new Error(`webhook setup failed: ${r.text.slice(0, 300)}`);
    return id;
  };
  probe("L.webhook_delete_foreign_denied", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-hook-alpha", ["*"]);
    const beta = await mint(w, "beta", "probe-l-hook-beta", ["*"]);
    const webhookId = await registerHook(w, alpha);
    const r = await callTool(w, beta, "webhook_delete", { webhookId });
    expect(denialNames(r, "beta")).toBe(true);
    const list = await callTool(w, alpha, "webhook_list", {});
    expect(list.text).toContain(webhookId);
  });
  test("L.webhook_delete_foreign_denied control: the registrant deletes its own, and fleet.admin deletes a foreign one", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-l-hook-alpha2", ["*"]);
    const admin = await mint(w, "beta", "probe-l-hook-admin", ["*", "fleet.admin"]);
    expect((await callTool(w, alpha, "webhook_delete", { webhookId: await registerHook(w, alpha) })).json?.success).toBe(true);
    expect((await callTool(w, admin, "webhook_delete", { webhookId: await registerHook(w, alpha) })).json?.success).toBe(true);
  });
});
