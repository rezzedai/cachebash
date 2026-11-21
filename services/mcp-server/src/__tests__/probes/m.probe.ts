import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { emulatorDb } from "./harness/emulator";
import { writeKey } from "./harness/seed";
import { probe } from "./harness/registry";
import { rest } from "./harness/client";
import { mint } from "./harness/mint";
import { seedTenant } from "./harness/seed";
import { firebaseCred } from "./harness/firebase";
import { nextN } from "./harness/cases";
import { marker } from "./harness/data";
import { Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { assertEmulatorOnly } from "./harness/guard";
import { MCP_SERVER_DIR } from "./harness/server";
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
    for (const target of ["alpha", "beta"]) {
      await emulatorDb().collection(`tenants/${w.tenants.A}/tasks`).add({ target, status: "created", createdAt: Timestamp.now(), title: `m-stats-${target}` });
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
    await emulatorDb().doc(`tenants/${w.tenants.A}/programs/${target}`).set({ // a relay target must be a registered program
      programId: target, displayName: target, role: "custom", color: "#808080", groups: [], tags: [],
      createdAt: Timestamp.now(), createdBy: "probe-m", active: true,
    });
    const ids: string[] = [];
    for (const n of ["first", "second", "third"]) ids.push(await sendTo(w, target, `unread-${n}`));
    const r = await rest(w, phone(w), "GET", `/v1/messages/unread?sessionId=${target}`);
    expect(`${r.httpStatus} ${r.text.slice(0, 240)}`).toMatch(/^200 /);
    const data = r.json?.data;
    expect(Array.isArray(data?.messages)).toBe(true);
    expect(data.count).toBe(data.messages.length);
    // get_messages also returns the tenant's broadcasts (target "all"), which the phone cannot clear; the three sent here keep their newest-first order
    expect(data.messages.map((m: any) => m.id).filter((id: string) => ids.includes(id))).toEqual([...ids].reverse());
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

/** The `authz_denial` lines the server wrote after byte offset `from`. */
const denialLines = (w: World, from: number): any[] =>
  fs.readFileSync(w.serverLog).subarray(from).toString("utf8").split("\n")
    .filter((l) => l.includes('"event":"authz_denial"'))
    .map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } })
    .filter(Boolean);
const logSize = (w: World): number => fs.statSync(w.serverLog).size;

/**
 * index.ts hands the REST router only /v1/ paths and /enroll, so /admin/reset-program-cache is not reachable over HTTP
 * (measured in PR-M, reported to ISO). The route is exercised through the BUILT router in a child process instead: a
 * scratch build under a mutation run is the code under test.
 */
function adminResetCache(key: string): { status: number; denials: any[] } {
  const target = assertEmulatorOnly();
  const dir = process.env.PROBE_SERVER_DIR || MCP_SERVER_DIR;
  const code = `
    const http = require("http");
    const { initializeFirebase } = require(${JSON.stringify(path.join(dir, "dist/firebase/client.js"))});
    initializeFirebase();
    const { createRestRouter } = require(${JSON.stringify(path.join(dir, "dist/transport/rest.js"))});
    const srv = http.createServer(createRestRouter());
    srv.listen(0, "127.0.0.1", async () => {
      const r = await fetch("http://127.0.0.1:" + srv.address().port + "/admin/reset-program-cache", {
        method: "POST", headers: { Authorization: "Bearer " + process.env.PROBE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ programId: "alpha" }),
      });
      process.stdout.write("STATUS:" + r.status + "\\n");
      process.exit(0);
    });`;
  const r = spawnSync(process.execPath, ["-e", code], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PROBE_KEY: key, FIREBASE_PROJECT_ID: target.projectId, GCLOUD_PROJECT: target.projectId, FIRESTORE_EMULATOR_HOST: target.emulatorHost },
  });
  const line = r.stdout.split("\n").find((l) => l.startsWith("STATUS:"));
  if (!line) throw new Error(`router run failed: ${r.stderr.slice(0, 1500)}`);
  const denials = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => l.includes('"event":"authz_denial"')).map((l) => JSON.parse(l.slice(l.indexOf("{"))));
  return { status: Number(line.slice(7)), denials };
}

describe("M D-1 denial metric", () => {
  // the 403 of /admin/reset-program-cache logs one denial; a successful PUT /v1/budget logs none (it used to log a false one)
  probe("M.reset_cache_denial_logged", async () => {
    const w = world();
    const r = adminResetCache(w.creds.scoped.key);
    expect(r.status).toBe(403);
    const lines = r.denials.filter((l) => l.tool === "admin_reset_program_cache");
    expect(lines).toHaveLength(1);
    expect(lines[0].principal).toBe("alpha");
  });
  test("M.reset_cache_denial_logged control: a * key passes the route and a successful set_budget adds no denial line", async () => {
    const w = world();
    const ok = adminResetCache(w.creds.wildcard.key);
    expect(ok.status).toBe(200);
    expect(ok.denials).toEqual([]);
    const from = logSize(w);
    const r = await rest(w, w.creds.wildcard, "PUT", "/v1/budget", { monthlyBudgetUsd: 100 });
    expect(r.httpStatus).toBe(200);
    await new Promise((res) => setTimeout(res, 300));
    expect(denialLines(w, from)).toEqual([]);
  });
});

/** A REST answer that refuses the call: HTTP 4xx, or an inner success:false, with the principal named in quotes. */
const restDenied = (r: { httpStatus: number; text: string; json: any }, principal: string): boolean => {
  const refused = r.httpStatus >= 400 || r.json?.data?.success === false;
  const text = [r.json?.data?.error, r.json?.error?.message, r.json?.error].filter((v) => typeof v === "string").join(" ") || r.text;
  return refused && text.includes(`"${principal}"`);
};
const sendTo = async (w: World, target: string, tag: string): Promise<string> => {
  if (target === "all") { // a send to "all" is fanned out per program; the shared broadcast doc is written as the K probe writes it
    const ref = emulatorDb().collection(`tenants/${w.tenants.A}/relay`).doc();
    await ref.set({ source: "legacy", target: "all", message: `m-${tag}-${nextN()}`, message_type: "STATUS", priority: "normal", action: "queue", status: "pending", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 3600_000) });
    return ref.id;
  }
  const sent = await callTool(w, w.seeders.A, "relay_send_message", { message: `m-${tag}-${nextN()}`, source: "legacy", target, message_type: "DIRECTIVE" });
  if (!sent.json?.messageId) throw new Error(`send failed: ${sent.text.slice(0, 200)}`);
  return sent.json.messageId as string;
};
const relayDoc = async (w: World, id: string) => (await emulatorDb().doc(`tenants/${w.tenants.A}/relay/${id}`).get()).data() ?? {};

describe("M relay routes (rows 1 and 2)", () => {
  // row 1: with no sessionId the route read the whole tenant; it now reads the principal's own inbox
  probe("M.unread_default_self", async () => {
    const w = world();
    const beta = await sendTo(w, "beta", "unread-beta");
    const r = await rest(w, w.creds.scoped, "GET", "/v1/messages/unread");
    expect(r.httpStatus).toBe(200);
    expect(r.text).not.toContain(beta);
  });
  test("M.unread_default_self control: alpha sees its own pending message", async () => {
    const w = world();
    const own = await sendTo(w, "alpha", "unread-alpha");
    const r = await rest(w, w.creds.scoped, "GET", "/v1/messages/unread");
    expect(r.json?.data?.messages?.map((m: any) => m.id)).toContain(own);
  });

  probe("M.unread_foreign_denied", async () => {
    const w = world();
    const beta = await sendTo(w, "beta", "unread-foreign");
    const r = await rest(w, w.creds.scoped, "GET", "/v1/messages/unread?sessionId=beta");
    expect(restDenied(r, "alpha")).toBe(true);
    expect(r.text).not.toContain(beta);
  });
  test("M.unread_foreign_denied control: the dispatcher reads beta's inbox", async () => {
    const w = world();
    const beta = await sendTo(w, "beta", "unread-foreign-ctl");
    const dispatcher = await mint(w, "dispatcher", "probe-m-dispatcher-unread", ["*"]);
    const r = await rest(w, dispatcher, "GET", "/v1/messages/unread?sessionId=beta");
    expect(r.json?.data?.messages?.map((m: any) => m.id)).toContain(beta);
  });

  // row 2 (M-D1)
  probe("M.mark_read_foreign_denied", async () => {
    const w = world();
    const id = await sendTo(w, "beta", "mr-foreign");
    const r = await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [id] });
    expect(restDenied(r, "alpha")).toBe(true);
    expect((await relayDoc(w, id)).status).toBe("pending");
  });
  test("M.mark_read_foreign_denied control: beta marks its own message", async () => {
    const w = world();
    const id = await sendTo(w, "beta", "mr-own");
    const beta = await mint(w, "beta", "probe-m-beta-markread", ["*"]);
    const r = await rest(w, beta, "POST", "/v1/messages/mark_read", { messageIds: [id] });
    expect(r.httpStatus).toBe(200);
    expect((await relayDoc(w, id)).status).toBe("read");
  });

  probe("M.mark_read_broadcast_unchanged", async () => {
    const w = world();
    const id = await sendTo(w, "all", "mr-broadcast");
    const before = await relayDoc(w, id);
    const r = await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [id] });
    expect(r.httpStatus).toBe(200);
    const after = await relayDoc(w, id);
    expect(after.status).toBe(before.status);
    expect(after.deliveryAttempts).toEqual(before.deliveryAttempts);
    expect(after.readAt).toBeUndefined();
  });
  test("M.mark_read_broadcast_unchanged control: alpha marks its own direct message", async () => {
    const w = world();
    const id = await sendTo(w, "alpha", "mr-direct");
    const r = await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [id] });
    expect(r.httpStatus).toBe(200);
    expect((await relayDoc(w, id)).status).toBe("read");
  });

  // VECTOR review #513 item 1: ids that are not strings leave nothing to read; the route answers 400 and writes nothing
  test("M.mark_read ids with no string id answer 400 and write nothing", async () => {
    const w = world();
    const from = logSize(w);
    for (const messageIds of [[1], [null, ""], [{}]]) {
      const r = await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds });
      expect(`${r.httpStatus} ${r.json?.error?.code}`).toBe("400 VALIDATION_ERROR");
    }
    const own = await sendTo(w, "alpha", "mr-bad-ids");
    await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [1] });
    expect((await relayDoc(w, own)).status).toBe("pending");
    expect(denialLines(w, from)).toEqual([]);
  });

  // 21.1 nit: a missing id is counted as notFound, is not a denial and writes no denial line
  test("M.mark_read missing id is notFound, not a denial", async () => {
    const w = world();
    const from = logSize(w);
    const r = await rest(w, w.creds.scoped, "POST", "/v1/messages/mark_read", { messageIds: [`missing-${nextN()}`] });
    expect(r.httpStatus).toBe(200);
    expect(r.json?.data?.notFound).toBe(1);
    await new Promise((res) => setTimeout(res, 300));
    expect(denialLines(w, from)).toEqual([]);
  });
});

const statRow = async (w: World, target: string) =>
  emulatorDb().collection(`tenants/${w.tenants.A}/tasks`).add({ target, status: "created", createdAt: Timestamp.now(), title: `m-stat-${target}` }); // the route counts `status`, the field the task writers store

describe("M tasks stats (row 3)", () => {
  probe("M.task_stats_default_self", async () => {
    const w = world();
    await statRow(w, "alpha");
    await statRow(w, "beta");
    await statRow(w, "beta");
    const mine = await rest(w, w.creds.scoped, "GET", "/v1/tasks/stats");
    expect(mine.httpStatus).toBe(200);
    const alphaOnly = await rest(w, w.creds.observer, "GET", "/v1/tasks/stats?target=alpha");
    const betaOnly = await rest(w, w.creds.observer, "GET", "/v1/tasks/stats?target=beta");
    expect(alphaOnly.json?.data?.total).toBeGreaterThanOrEqual(1);
    expect(betaOnly.json?.data?.total).toBeGreaterThanOrEqual(2);
    expect(mine.json?.data?.total).toBe(alphaOnly.json.data.total); // alpha's count excludes beta's rows
    const foreign = await rest(w, w.creds.scoped, "GET", "/v1/tasks/stats?target=beta");
    expect(restDenied(foreign, "alpha")).toBe(true);
  });
  test("M.task_stats_default_self control: an observer counts every target", async () => {
    const w = world();
    await statRow(w, "alpha");
    await statRow(w, "beta");
    const all = await rest(w, w.creds.observer, "GET", "/v1/tasks/stats");
    const a = await rest(w, w.creds.observer, "GET", "/v1/tasks/stats?target=alpha");
    const b = await rest(w, w.creds.observer, "GET", "/v1/tasks/stats?target=beta");
    expect(all.json?.data?.total).toBeGreaterThanOrEqual(a.json.data.total + b.json.data.total);
  });
});

const archivedSession = async (w: World, program: string): Promise<string> => {
  const sessionId = `${program}-h${nextN()}`;
  await emulatorDb().doc(`tenants/${w.tenants.A}/sessions/${sessionId}`).set({
    name: `m-hist-${sessionId}`, programId: program, status: "complete", archived: true, currentAction: `m-hist-${sessionId}`,
    createdAt: Timestamp.fromMillis(Date.now() - 600_000), lastUpdate: Timestamp.now(),
  });
  return sessionId;
};

describe("M sessions routes (rows 4 and 5)", () => {
  probe("M.sessions_history_scoped", async () => {
    const w = world();
    const mine = await archivedSession(w, "alpha");
    const theirs = await archivedSession(w, "beta");
    const r = await rest(w, w.creds.scoped, "GET", "/v1/sessions/history");
    expect(r.httpStatus).toBe(200);
    const ids = (r.json?.data?.sessions ?? []).map((s: any) => s.sessionId);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });
  test("M.sessions_history_scoped control: an observer sees both programs' archived sessions", async () => {
    const w = world();
    const a = await archivedSession(w, "alpha");
    const b = await archivedSession(w, "beta");
    const r = await rest(w, w.creds.observer, "GET", "/v1/sessions/history");
    const ids = (r.json?.data?.sessions ?? []).map((s: any) => s.sessionId);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
  });
  // row 4: no requireAdmin; a plain program key lists its own sessions only
  test("M.sessions_list_default_self: a program key lists its own sessions, not the tenant's", async () => {
    const w = world();
    const r = await rest(w, w.creds.scoped, "GET", "/v1/sessions?limit=50");
    expect(r.httpStatus).toBe(200);
    expect(r.text).toContain(marker("A", "alpha"));
    expect(r.text).not.toContain(marker("A", "beta"));
  });
});

describe("M sprints active (row 6)", () => {
  const newSprint = async (w: World, cred: WorldCredential): Promise<string> => {
    const r = await callTool(w, cred, "sprint_create_sprint", { projectName: `m-${nextN()}`, branch: "m", stories: [{ id: "s1", title: "m-story" }] });
    const id = (r.json?.sprintId ?? r.json?.id) as string | undefined;
    if (!id) throw new Error(`sprint setup failed: ${r.text.slice(0, 300)}`);
    return id;
  };
  probe("M.sprints_active_filtered", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-m-beta-sprint", ["*"]);
    const theirs = await newSprint(w, beta);
    const mine = await newSprint(w, w.creds.scoped);
    const r = await rest(w, w.creds.scoped, "GET", "/v1/sprints/active");
    expect(r.httpStatus).toBe(200);
    const ids = (r.json?.data?.sprints ?? []).map((s: any) => s.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });
  test("M.sprints_active_filtered control: the creator sees its sprint and the phone sees both", async () => {
    const w = world();
    const beta = await mint(w, "beta", "probe-m-beta-sprint-ctl", ["*"]);
    const theirs = await newSprint(w, beta);
    const own = await rest(w, beta, "GET", "/v1/sprints/active");
    expect((own.json?.data?.sprints ?? []).map((s: any) => s.id)).toContain(theirs);
    const all = await rest(w, phone(w), "GET", "/v1/sprints/active");
    expect((all.json?.data?.sprints ?? []).map((s: any) => s.id)).toContain(theirs);
  });
});

describe("M capability gates (rows 7 to 10)", () => {
  const bare = (w: World, label: string) => mint(w, "alpha", `probe-m-${label}`, ["dispatch.read"]);
  probe("M.budget_summary_needs_metrics_read", async () => {
    const w = world();
    const denied = await rest(w, await bare(w, "budget"), "GET", "/v1/budget/summary");
    expect(denied.httpStatus).toBe(403);
  });
  test("M.budget_summary_needs_metrics_read control: a * key reads it", async () => {
    const w = world();
    expect((await rest(w, w.creds.wildcard, "GET", "/v1/budget/summary")).httpStatus).toBe(200);
  });
  probe("M.dreams_peek_needs_dream_read", async () => {
    const w = world();
    const key = await bare(w, "dreams");
    expect((await rest(w, key, "GET", "/v1/dreams/peek")).httpStatus).toBe(403);
    expect((await rest(w, key, "GET", "/v1/dreams")).httpStatus).toBe(403);
  });
  test("M.dreams_peek_needs_dream_read control: a * key reads both routes", async () => {
    const w = world();
    expect((await rest(w, w.creds.wildcard, "GET", "/v1/dreams/peek")).httpStatus).toBe(200);
    expect((await rest(w, w.creds.wildcard, "GET", "/v1/dreams")).httpStatus).toBe(200);
  });
  probe("M.gsp_proposals_needs_gsp_read", async () => {
    const w = world();
    const key = await bare(w, "gsp");
    expect((await rest(w, key, "GET", "/v1/gsp/proposals")).httpStatus).toBe(403);
    expect((await rest(w, key, "GET", "/v1/gsp/namespaces")).httpStatus).toBe(403);
  });
  test("M.gsp_proposals_needs_gsp_read control: a * key reads both routes", async () => {
    const w = world();
    expect((await rest(w, w.creds.wildcard, "GET", "/v1/gsp/proposals")).httpStatus).toBe(200);
    expect((await rest(w, w.creds.wildcard, "GET", "/v1/gsp/namespaces")).httpStatus).toBe(200);
  });
});

describe("M portal relay (row 13)", () => {
  const OWNER_UID = "7viFKVtl5lgzguhFoZlnYYrqeDG2"; // PORTAL_PRINCIPALS in firebaseAuthValidator.ts
  probe("M.relay_mobile_principal", async () => {
    const w = world();
    const from = logSize(w);
    const r = await rest(w, phone(w), "POST", "/v1/relay/messages", { message: "m-portal", target: "alpha", message_type: "DIRECTIVE" });
    expect(r.httpStatus).toBe(403);
    expect(r.json?.message ?? r.text).toContain('"mobile"');
    await new Promise((res) => setTimeout(res, 300));
    expect(denialLines(w, from).filter((l) => l.tool === "relay_send_message" && l.principal === "mobile")).toHaveLength(1);
  });
  test("M.relay_mobile_principal control: the owner's Firebase token sends", async () => {
    const w = world();
    await seedTenant(OWNER_UID); // the owner's own tenant: mutation ceilings and the two programs
    const owner = firebaseCred(w, OWNER_UID, { email: "christian@rezzed.ai", emailVerified: true });
    const r = await rest(w, owner, "POST", "/v1/relay/messages", { message: "m-portal-owner", target: "alpha", message_type: "DIRECTIVE" });
    expect(`${r.httpStatus} ${r.text.slice(0, 200)}`).toMatch(/^201 /);
  });
});
