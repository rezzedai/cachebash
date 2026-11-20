import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { probe } from "./harness/registry";
import { rest } from "./harness/client";
import { mint } from "./harness/mint";
import { firebaseCred } from "./harness/firebase";
import { nextN } from "./harness/cases";
import { marker } from "./harness/data";
import { Timestamp } from "firebase-admin/firestore";
import type { World, WorldCredential } from "./harness/world";

/** M (R5): a self-read whose state document cannot be read must say so, not return an empty memory block. */
describe("M bootstrap self-read failure", () => {
  probe("M.unreadable_state_is_an_error", async () => {
    const w = world();
    const mkProgram = async (name: string, corrupt: boolean) => {
      const caps = w.creds.scoped.capabilities;
      const k = await writeKey(w.tenants.A, name, `probe-m-${name}`, caps);
      await emulatorDb().doc(`tenants/${w.tenants.A}/sessions/_meta/program_state/${name}`).set(
        corrupt
          ? { programId: name, learnedPatterns: "not-an-array", contextSummary: { handoffNotes: "m-hidden" } }
          : { programId: name, learnedPatterns: [], contextSummary: { handoffNotes: "m-readable", lastTask: null, activeWorkItems: [], openQuestions: [] } }
      );
      return { ...w.creds.scoped, programId: name, key: k.key, keyHash: k.keyHash };
    };
    // control: a readable document comes back as memory
    const good = await callTool(w, await mkProgram("m-good", false), "gsp_bootstrap", { agentId: "m-good" });
    expect(good.json?.success).toBe(true);
    expect(good.text).toContain("m-readable");
    // deny: an unreadable one is reported as an error
    const bad = await callTool(w, await mkProgram("m-bad", true), "gsp_bootstrap", { agentId: "m-bad" });
    expect(bad.json?.success).toBe(true);
    expect(bad.json?.payload?.memory?.status).toBe("error");
  });
});

/**
 * M (RD-5 PR-M, plan section 21 G and 21.1 C1): the live REST callers. Each exists in grid or in apps/mobile today.
 * Every probe passes on unmodified 20a46afd and after every PR-M commit. If one fails, the PR stops (section 21 G).
 */
const sessionOf = async (w: World, program: string): Promise<string> => {
  const sessionId = `${program}-m${nextN()}`;
  const r = await callTool(w, w.stateSeeders.A, "pulse_create_session", { name: `m-${sessionId}`, sessionId, programId: program, status: "m-fresh" });
  if (r.json?.success !== true) throw new Error(`session setup failed: ${r.text.slice(0, 300)}`);
  return sessionId;
};
const taskFor = async (w: World, target: string): Promise<string> => {
  const made = await callTool(w, w.stateSeeders.A, "dispatch_create_task", { title: `m-${nextN()}`, target, source: "legacy", instructions: "m-task" });
  if (!made.json?.taskId) throw new Error(`task setup failed: ${made.text.slice(0, 300)}`);
  return made.json.taskId as string;
};
/** the phone: a Firebase ID token whose uid is tenant A (programId "mobile", the mobile default capabilities) */
const phone = (w: World): WorldCredential => firebaseCred(w, w.tenants.A);

describe("M fleet paths (REST)", () => {
  // grid dispatcher cachebash-client.ts:316 GET /v1/sessions, key holds * and fleet.observe
  probe("M.fleet_path_dispatcher_rest_lists_sessions", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-m-dispatcher-list", ["*", "fleet.observe"]);
    const r = await rest(w, dispatcher, "GET", "/v1/sessions?limit=50");
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.text).toContain(marker("A", "alpha"));
    expect(r.text).toContain(marker("A", "beta"));
  });

  // cachebash-client.ts:301 POST /v1/sessions, :331 PATCH /v1/sessions/:id
  probe("M.fleet_path_dispatcher_rest_session_writes", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-m-dispatcher-writes", ["*", "fleet.observe"]);
    await emulatorDb().doc(`tenants/${w.tenants.A}/config/billing`).set({ tier: "team" }); // REST create_session is pricing-checked; a fresh tenant is on the free tier (1 concurrent session)
    const sessionId = `beta-g${nextN()}`;
    const made = await rest(w, dispatcher, "POST", "/v1/sessions", { sessionId, programId: "beta", name: `m-${sessionId}`, status: "m-spawn" });
    expect(`${made.httpStatus} ${made.text.slice(0, 240)}`).toMatch(/^201 /);
    const upd = await rest(w, dispatcher, "PATCH", `/v1/sessions/${sessionId}`, { status: "m-dispatcher-update", lastHeartbeat: true });
    expect(`${upd.httpStatus} ${upd.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(upd.json?.data?.success).toBe(true);
  });

  // cachebash-client.ts:207 to :256 tasks GET, claim, complete, unclaim
  probe("M.fleet_path_dispatcher_rest_tasks", async () => {
    const w = world();
    const dispatcher = await mint(w, "dispatcher", "probe-m-dispatcher-tasks", ["*", "fleet.observe"]);
    const list = await rest(w, dispatcher, "GET", "/v1/tasks?target=beta&limit=50");
    expect(`${list.httpStatus} ${list.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(list.text).toContain(marker("A", "beta"));
    const t1 = await taskFor(w, "beta");
    const claimed = await rest(w, dispatcher, "POST", `/v1/tasks/${t1}/claim`, { sessionId: "beta" });
    expect(claimed.json?.data?.success).toBe(true);
    const done = await rest(w, dispatcher, "POST", `/v1/tasks/${t1}/complete`, { completed_status: "SUCCESS", model: "probe", provider: "probe", result: "m" });
    expect(done.json?.data?.success).toBe(true);
    const t2 = await taskFor(w, "beta");
    expect((await rest(w, dispatcher, "POST", `/v1/tasks/${t2}/claim`, { sessionId: "beta" })).json?.data?.success).toBe(true);
    const un = await rest(w, dispatcher, "POST", `/v1/tasks/${t2}/unclaim`, { reason: "manual" });
    expect(un.text.slice(0, 240) + un.json?.data?.success).toContain("true");
  });

  // cachebash-context-reporter.sh:75 PATCH /v1/sessions/:id on the program's own session
  probe("M.fleet_path_self_rest_update_session", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-m-alpha-self", ["*"]);
    const sessionId = await sessionOf(w, "alpha");
    const r = await rest(w, alpha, "PATCH", `/v1/sessions/${sessionId}`, { status: "m-self-update", contextUsedPct: 41, lastHeartbeat: true });
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.json?.data?.success).toBe(true);
  });

  // cachebash-check-interrupts.sh:31 GET /v1/interrupts/peek
  probe("M.fleet_path_self_interrupts_peek", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-m-alpha-peek", ["*"]);
    const r = await rest(w, alpha, "GET", "/v1/interrupts/peek?sessionId=alpha");
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.json?.data?.success).toBe(true);
    expect(r.text).toContain(marker("A", "alpha"));
  });

  // recognizer-host host_common.py:28 GET /v1/fleet/health with fleet.read and fleet.observe
  probe("M.fleet_path_vm_fleet_health_rest", async () => {
    const w = world();
    const watch = await mint(w, "orchestrator-watch", "probe-m-orch-watch", ["fleet.read", "fleet.observe"]);
    const r = await rest(w, watch, "GET", "/v1/fleet/health");
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.json?.data?.success).not.toBe(false);
  });

  // telemetry-capture.sh:118 POST /v1/tasks/:id/telemetry by the program that completed the task
  probe("M.fleet_path_self_rest_telemetry", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-m-beta-telemetry", ["*"]);
    const taskId = await taskFor(w, "beta");
    expect((await callTool(w, beta, "dispatch_claim_task", { taskId })).json?.success).toBe(true);
    expect((await callTool(w, beta, "dispatch_complete_task", { taskId, completed_status: "SUCCESS", model: "probe", provider: "probe", result: "m" })).json?.success).toBe(true);
    const r = await rest(w, beta, "POST", `/v1/tasks/${taskId}/telemetry`, { tokens_in: 1, tokens_out: 2, cost_usd: 0.01, telemetry_source: "host-hook" });
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.json?.data?.success).toBe(true);
  });

  // 21.1 C1: apps/mobile api.ts calls five of the routes with a Firebase-minted credential
  probe("M.fleet_path_mobile_task_stats", async () => {
    const w = world();
    // the route counts the `lifecycle` field, which no task handler writes (they write `status`), so every real tenant reads 0.
    // Rows that carry the field are written here, so the probe measures scope and not that defect.
    for (const target of ["alpha", "beta"]) {
      await emulatorDb().collection(`tenants/${w.tenants.A}/tasks`).add({ target, lifecycle: "created", createdAt: Timestamp.now(), title: `m-stats-${target}` });
    }
    const own = await rest(w, phone(w), "GET", "/v1/tasks/stats");
    expect(`${own.httpStatus} ${own.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(own.json?.data?.total).toBeGreaterThanOrEqual(2); // both seeded programs' tasks, not one queue
    const foreign = await rest(w, phone(w), "GET", "/v1/tasks/stats?target=beta");
    expect(`${foreign.httpStatus} ${foreign.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(foreign.json?.data?.target).toBe("beta");
    expect(foreign.json?.data?.total).toBeGreaterThanOrEqual(1);
  });

  // api.ts:222 getUnreadMessages: { messages, count }, newest first
  probe("M.fleet_path_mobile_unread", async () => {
    const w = world();
    const target = `m-unread-${nextN()}`;
    const ids: string[] = [];
    for (const n of ["first", "second", "third"]) {
      const sent = await callTool(w, w.seeders.A, "relay_send_message", { message: `m-${n}`, source: "legacy", target, message_type: "DIRECTIVE" });
      ids.push(sent.json.messageId as string);
    }
    const r = await rest(w, phone(w), "GET", `/v1/messages/unread?sessionId=${target}`);
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    const data = r.json?.data;
    expect(Array.isArray(data?.messages)).toBe(true);
    expect(data.count).toBe(data.messages.length);
    expect(data.messages.map((m: any) => m.id)).toEqual([...ids].reverse());
  });

  // api.ts:227 markMessagesRead on a message addressed to a program (the phone reads every inbox)
  probe("M.fleet_path_mobile_mark_read", async () => {
    const w = world();
    const sent = await callTool(w, w.seeders.A, "relay_send_message", { message: `m-mr-${nextN()}`, source: "legacy", target: "alpha", message_type: "DIRECTIVE" });
    const id = sent.json.messageId as string;
    const r = await rest(w, phone(w), "POST", "/v1/messages/mark_read", { messageIds: [id] });
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect((await emulatorDb().doc(`tenants/${w.tenants.A}/relay/${id}`).get()).data()?.status).toBe("read");
  });

  // api.ts:337 getActiveSprints: a sprint another program created
  probe("M.fleet_path_mobile_sprints_active", async () => {
    const w = world();
    const alpha = await mint(w, "alpha", "probe-m-alpha-sprint", ["*"]);
    const made = await callTool(w, alpha, "sprint_create_sprint", { projectName: `m-${nextN()}`, branch: "m", stories: [{ id: "s1", title: "m-story" }] });
    const sprintId = (made.json?.sprintId ?? made.json?.id) as string;
    expect(sprintId).toBeTruthy();
    const r = await rest(w, phone(w), "GET", "/v1/sprints/active");
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect((r.json?.data?.sprints ?? []).map((s: any) => s.id)).toContain(sprintId);
  });

  // api.ts:120 listSessions
  probe("M.fleet_path_mobile_sessions", async () => {
    const w = world();
    const r = await rest(w, phone(w), "GET", "/v1/sessions?limit=50");
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    expect(r.text).toContain(marker("A", "alpha"));
    expect(r.text).toContain(marker("A", "beta"));
  });
});
