import { callTool } from "./client";
import type { WorldCredential } from "./world";

export type TenantLetter = "A" | "B";
export type ProgramName = "alpha" | "beta";

/** The marker that tags every seeded row of (tenant, program). A probe "sees" a program's data when this appears in a result. */
export const marker = (t: TenantLetter, p: string): string => `mk-${t}-${p}`;
/** tags the message that `p` SENT (to the other program); not a substring of `marker`, so inbox reads do not blur the two */
export const sentMarker = (t: TenantLetter, p: string): string => `sm-${t}-${p}`;

export interface SeededProgram {
  marker: string;
  taskId: string;
  scheduleId: string;
  sessionId: string;
  patternId: string;
  messageId: string;
}

export type SeedData = Record<TenantLetter, Record<ProgramName, SeededProgram>>;

async function must(label: string, p: ReturnType<typeof callTool>): Promise<any> {
  const r = await p;
  if (r.isError || r.json?.success === false) throw new Error(`seed step failed: ${label}: ${r.text.slice(0, 300)}`);
  return r.json;
}

/**
 * Seeds every row through the real handlers, as the per-tenant `legacy` wildcard seeder
 * (never directly into Firestore), so the rows have exactly the shape the server reads back.
 */
export async function seedData(world: { baseUrl: string }, seeders: Record<TenantLetter, WorldCredential>): Promise<SeedData> {
  const w = world as any;
  const out = {} as SeedData;
  for (const t of ["A", "B"] as const) {
    const S = seeders[t];
    out[t] = {} as Record<ProgramName, SeededProgram>;
    for (const p of ["alpha", "beta"] as const) {
      const mk = marker(t, p);
      await must(`state ${t}/${p}`, callTool(w, S, "state_update_program_state", { programId: p, contextSummary: { handoffNotes: mk, activeWorkItems: [] } }));
      const patternId = `pat-${t}-${p}`;
      const now = new Date().toISOString();
      await must(`memory ${t}/${p}`, callTool(w, S, "state_store_memory", {
        programId: p,
        pattern: { id: patternId, domain: "probe", pattern: mk, confidence: 0.9, evidence: mk, discoveredAt: now, lastReinforced: now },
      }));
      const task = await must(`task ${t}/${p}`, callTool(w, S, "dispatch_create_task", { title: mk, target: p, source: "legacy", instructions: mk }));
      const msg = await must(`message ${t}/${p}`, callTool(w, S, "relay_send_message", { message: mk, source: "legacy", target: p, message_type: "DIRECTIVE" }));
      const sessionId = `${p}-s1`;
      await must(`session ${t}/${p}`, callTool(w, S, "pulse_create_session", { name: mk, sessionId, programId: p, status: mk }));
      // context history (pulse_get_context_utilization) and a sent message with source=p (relay_get_sent_messages / history)
      await must(`ctx ${t}/${p}`, callTool(w, S, "pulse_update_session", { sessionId, status: mk, contextUsedPct: 42, lastHeartbeat: true }));
      await must(`sent ${t}/${p}`, callTool(w, S, "relay_send_message", { message: sentMarker(t, p), source: p, target: p === "alpha" ? "beta" : "alpha", message_type: "STATUS" }));
      const sched = await must(`schedule ${t}/${p}`, callTool(w, S, "schedule_create", { name: mk, target: p, cron: "0 0 1 1 *", taskTemplate: { title: mk } }));
      out[t][p] = {
        marker: mk, taskId: task.taskId, scheduleId: sched.scheduleId ?? sched.id, sessionId, patternId, messageId: msg.messageId,
      };
    }
  }
  return out;
}
