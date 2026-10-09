import { callTool, ToolResult } from "./client";
import { emulatorDb } from "./emulator";
import { marker, sentMarker, ProgramName } from "./data";
import { sees } from "./judge";
import type { CredentialName, World } from "./world";

export interface Ctx {
  w: World;
  subject: ProgramName;
  /** unique per call, for names that must not collide */
  n: string;
}

export interface Case {
  /** the tool (or REST route) under test; the probe id is `T2.<id>` */
  id: string;
  tool: string;
  /** credential making the call; default `scoped` (the wingman preset has no write capability, so it would be denied at the capability gate, not the identity gate) */
  cred?: CredentialName;
  /** set up per call, as the seeder, before the call */
  prepare?: (c: Ctx) => Promise<void>;
  args: (c: Ctx) => Record<string, unknown>;
  /** true when the call reached the subject's data (read) or changed the subject's state (write) */
  reached: (c: Ctx, r: ToolResult) => Promise<boolean>;
  /** undo the effect so cases stay independent */
  cleanup?: (c: Ctx) => Promise<void>;
}

export const seederCall = (c: Ctx, tool: string, args: Record<string, unknown> = {}) => callTool(c.w, c.w.seeders.A, tool, args);
const mk = (c: Ctx) => marker("A", c.subject);
let counter = 0;
export const nextN = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}`;
const programDoc = async (c: Ctx) => (await emulatorDb().doc(`tenants/${c.w.tenants.A}/programs/${c.subject}`).get()).data() ?? {};

const readMarker = (tool: string, argName: string, extra: Record<string, unknown> = {}, tag: (c: Ctx) => string = mk): Case => ({
  id: tool,
  tool,
  args: (c) => ({ [argName]: c.subject, ...extra }),
  reached: async (c, r) => sees(r, tag(c)),
});

/** Tools with an identifier argument that select a program, session or target (recon section 8). */
export const CASES: Case[] = [
  // --- state family (recon rows 3-10): gated by canRead/canWrite
  readMarker("state_get_program_state", "programId"),
  readMarker("state_recall_memory", "programId"),
  {
    id: "state_memory_health", tool: "state_memory_health",
    args: (c) => ({ programId: c.subject }),
    reached: async (_c, r) => !!r.json?.success && JSON.stringify(r.json).includes("total"),
  },
  {
    id: "state_get_context_history", tool: "state_get_context_history",
    args: (c) => ({ programId: c.subject }),
    reached: async (_c, r) => !!r.json?.success && Array.isArray(r.json?.entries) && r.json.entries.length > 0,
  },
  {
    id: "state_store_memory", tool: "state_store_memory",
    args: (c) => {
      const now = new Date().toISOString();
      return { programId: c.subject, pattern: { id: `w-${c.n}`, domain: "probe", pattern: `w-${c.n}`, confidence: 0.5, evidence: "probe", discoveredAt: now, lastReinforced: now } };
    },
    reached: async (c) => (await seederCall(c, "state_recall_memory", { programId: c.subject })).text.includes(`w-${c.n}`),
  },
  {
    id: "state_update_program_state", tool: "state_update_program_state",
    args: (c) => ({ programId: c.subject, contextSummary: { handoffNotes: `wr-${c.n}`, activeWorkItems: [] } }),
    reached: async (c) => (await seederCall(c, "state_get_program_state", { programId: c.subject })).text.includes(`wr-${c.n}`),
  },
  {
    id: "state_delete_memory", tool: "state_delete_memory",
    prepare: async (c) => {
      const now = new Date().toISOString();
      await seederCall(c, "state_store_memory", { programId: c.subject, pattern: { id: `del-${c.n}`, domain: "probe", pattern: `del-${c.n}`, confidence: 0.5, evidence: "probe", discoveredAt: now, lastReinforced: now } });
    },
    args: (c) => ({ programId: c.subject, patternId: `del-${c.n}` }),
    reached: async (c) => !(await seederCall(c, "state_recall_memory", { programId: c.subject })).text.includes(`del-${c.n}`),
  },
  {
    id: "state_reinforce_memory", tool: "state_reinforce_memory",
    args: (c) => ({ programId: c.subject, patternId: c.w.seed.A[c.subject].patternId, confidence: 0.8, evidence: `rf-${c.n}` }),
    reached: async (c) => (await seederCall(c, "state_recall_memory", { programId: c.subject })).text.includes(`rf-${c.n}`),
  },
  // --- pulse (rows 11-16)
  {
    id: "pulse_create_session", tool: "pulse_create_session",
    args: (c) => ({ name: `np-${c.n}`, sessionId: `${c.subject}-np${c.n}`, programId: c.subject, status: "x" }),
    reached: async (c) => (await seederCall(c, "pulse_list_sessions", { programId: c.subject, limit: 50 })).text.includes(`np-${c.n}`),
  },
  {
    id: "pulse_update_session", tool: "pulse_update_session",
    // a fresh session per call: an update rewrites `name`, which would erase the seeded read marker
    prepare: async (c) => { await seederCall(c, "pulse_create_session", { name: `fresh-${c.n}`, sessionId: `${c.subject}-u${c.n}`, programId: c.subject, status: "x" }); },
    args: (c) => ({ sessionId: `${c.subject}-u${c.n}`, status: `up-${c.n}`, state: "working" }),
    reached: async (c) => (await seederCall(c, "pulse_list_sessions", { programId: c.subject, limit: 50 })).text.includes(`up-${c.n}`),
  },
  readMarker("pulse_list_sessions", "programId", { limit: 50 }),
  {
    id: "pulse_get_context_utilization", tool: "pulse_get_context_utilization",
    args: (c) => ({ sessionId: c.w.seed.A[c.subject].sessionId }),
    reached: async (_c, r) => !!r.json?.success && r.json?.currentContextUsedPct === 42,
  },
  {
    id: "pulse_pause_program", tool: "pulse_pause_program",
    args: (c) => ({ programId: c.subject, reason: "probe" }),
    reached: async (c) => (await programDoc(c)).paused === true,
    cleanup: async (c) => { await seederCall(c, "pulse_resume_program", { programId: c.subject }); },
  },
  {
    id: "pulse_resume_program", tool: "pulse_resume_program",
    prepare: async (c) => { await seederCall(c, "pulse_pause_program", { programId: c.subject, reason: "probe-setup" }); },
    args: (c) => ({ programId: c.subject }),
    reached: async (c) => (await programDoc(c)).paused === false,
  },
  // --- relay (rows 19-21)
  {
    id: "relay_get_messages", tool: "relay_get_messages",
    args: (c) => ({ sessionId: `probe-${c.n}`, target: c.subject, markAsRead: false, includeDelivered: true }),
    reached: async (c, r) => sees(r, mk(c)),
  },
  readMarker("relay_get_sent_messages", "source", {}, (c) => sentMarker("A", c.subject)),
  readMarker("relay_query_message_history", "source", {}, (c) => sentMarker("A", c.subject)),
  // --- dispatch (rows 24, 29-33)
  {
    id: "dispatch_get_tasks", tool: "dispatch_get_tasks",
    args: (c) => ({ target: c.subject, requires_action: null, status: "all", limit: 50 }),
    reached: async (c, r) => sees(r, mk(c)),
  },
  ...(["dispatch_reassign_task", "dispatch_retry_task", "dispatch_replay_task"] as const).map((tool): Case => ({
    id: tool, tool,
    prepare: async (c) => {
      const t = await seederCall(c, "dispatch_create_task", { title: `mv-${c.n}`, target: "ops", source: "legacy", instructions: "x" });
      (c as any).taskId = t.json?.taskId;
      if (tool === "dispatch_retry_task") {
        await seederCall(c, "dispatch_claim_task", { taskId: (c as any).taskId });
        await seederCall(c, "dispatch_complete_task", { taskId: (c as any).taskId, completed_status: "FAILED", model: "probe", provider: "probe", error_code: "probe", error_class: "PERMANENT", result: "setup" });
      }
    },
    args: (c) => ({ taskId: (c as any).taskId, newTarget: c.subject, reason: "probe" }),
    reached: async (c, r) => {
      if (tool === "dispatch_replay_task") return (await seederCall(c, "dispatch_get_tasks", { target: c.subject, requires_action: null, status: "all", limit: 50 })).text.includes(`mv-${c.n}`);
      const t = await seederCall(c, "dispatch_get_task_by_id", { taskId: (c as any).taskId });
      return t.json?.task?.target === c.subject && !!r;
    },
  })),
  // --- schedule (rows 34-36)
  {
    id: "schedule_create", tool: "schedule_create",
    args: (c) => ({ name: `sc-${c.n}`, target: c.subject, cron: "0 0 1 1 *", taskTemplate: { title: `sc-${c.n}` } }),
    reached: async (c) => (await seederCall(c, "schedule_list", { target: c.subject })).text.includes(`sc-${c.n}`),
  },
  readMarker("schedule_list", "target"),
  {
    id: "schedule_update", tool: "schedule_update",
    prepare: async (c) => {
      const s = await seederCall(c, "schedule_create", { name: `su-${c.n}`, target: "ops", cron: "0 0 1 1 *", taskTemplate: { title: `su-${c.n}` } });
      (c as any).scheduleId = s.json?.scheduleId;
    },
    args: (c) => ({ scheduleId: (c as any).scheduleId, target: c.subject }),
    reached: async (c) => {
      const g = await seederCall(c, "schedule_get", { scheduleId: (c as any).scheduleId });
      return g.json?.schedule?.target === c.subject;
    },
  },
  // --- programs / audit / metrics / trace (rows 37-43)
  {
    id: "programs_update_program", tool: "programs_update_program",
    args: (c) => ({ programId: c.subject, displayName: `pu-${c.n}` }),
    reached: async (c) => (await programDoc(c)).displayName === `pu-${c.n}`,
  },
  {
    id: "audit_get_audit", tool: "audit_get_audit",
    args: (c) => ({ programId: c.subject }),
    reached: async (c, r) => !!r.json?.success && JSON.stringify(r.json).includes(`"${c.subject}"`),
  },
  {
    id: "audit_get_ack_compliance", tool: "audit_get_ack_compliance",
    args: (c) => ({ programId: c.subject }),
    reached: async (c, r) => !!r.json?.success && JSON.stringify(r.json).includes(c.subject),
  },
  {
    id: "metrics_get_rate_limit_events", tool: "metrics_get_rate_limit_events",
    prepare: async (c) => { await seederCall(c, "metrics_log_rate_limit_event", { sessionId: c.w.seed.A[c.subject].sessionId, modelTier: "t", endpoint: `ep-${c.n}`, backoffMs: 1 }); },
    args: (c) => ({ sessionId: c.w.seed.A[c.subject].sessionId }),
    reached: async (c, r) => !!r.json?.success && r.text.includes(`ep-${c.n}`),
  },
];
