import type { AuthContext } from "../auth/authValidator.js";
import { getFirestore } from "../firebase/client.js";
import { emitEvent } from "../modules/events.js";
import type { ComplianceState } from "../types/session.js";

type ComplianceResult =
  | { allowed: true; warning?: string }
  | { allowed: false; reason: string; code: "SESSION_TERMINATED" | "COMPLIANCE_BLOCKED" };

type ComplianceContext = {
  sessionId?: string;
  endpoint: "mcp" | "rest";
};

type CachedState = { state: ComplianceState; expires: number };

const CACHE_TTL_MS = 30_000;
const complianceCache = new Map<string, CachedState>();

export const COMPLIANCE_EXEMPT_TOOLS = new Set([
  "get_audit",
  "query_traces",
  "get_fleet_health",
  "get_operational_metrics",
  "get_comms_metrics",
  "get_cost_summary",
  "list_sessions",
  "get_sprint",
  "dream_peek",
  "list_groups",
  "list_keys",
  "create_session",
  "get_dead_letters",
  "query_message_history",
]);

export const EXEMPT_PROGRAMS = new Set(["legacy", "mobile", "admin", "admin-mirror", "bit"]);

const ORCHESTRATOR_PROGRAMS = new Set(["orchestrator", "iso", "alan", "vector", "quorra", "radia", "casp", "sark"]);
const BUILDER_PROGRAMS = new Set(["builder", "basher", "able", "beck"]);

const BOOT_TOOLS = new Set(["get_program_state", "get_tasks", "get_messages"]);

export function initializeCompliance(_userId: string, _sessionId: string): ComplianceState {
  return {
    state: "UNREGISTERED",
    boot: {
      gotProgramState: false,
      gotTasks: false,
      gotMessages: false,
    },
    journal: {
      toolCallsSinceLastJournal: 0,
      totalToolCalls: 0,
      journalActivated: false,
    },
    stateChangedAt: new Date().toISOString(),
    stateHistory: [],
  };
}

function getThresholds(programId: string): { warn: number; degrade: number } {
  if (ORCHESTRATOR_PROGRAMS.has(programId)) return { warn: 10, degrade: 25 };
  if (BUILDER_PROGRAMS.has(programId)) return { warn: 20, degrade: 40 };
  return { warn: 20, degrade: 40 };
}

function transitionState(state: ComplianceState, to: ComplianceState["state"], trigger: string): void {
  if (state.state === to) return;
  const at = new Date().toISOString();
  state.stateHistory.push({ from: state.state, to, trigger, at });
  state.state = to;
  state.stateChangedAt = at;
}

function persistCompliance(userId: string, sessionId: string, state: ComplianceState): void {
  try {
    const db = getFirestore();
    db.doc(`tenants/${userId}/sessions/${sessionId}`)
      .set({ compliance: state }, { merge: true })
      .catch((err) => {
        console.error("[Compliance] Persist failed:", err);
      });
  } catch (err) {
    console.error("[Compliance] Persist setup failed:", err);
  }
}

async function loadComplianceState(userId: string, sessionId: string): Promise<ComplianceState> {
  const now = Date.now();
  const cached = complianceCache.get(sessionId);
  if (cached && cached.expires > now) {
    return cached.state;
  }

  const db = getFirestore();
  const doc = await db.doc(`tenants/${userId}/sessions/${sessionId}`).get();
  const persisted = doc.data()?.compliance as ComplianceState | undefined;
  const state = persisted || initializeCompliance(userId, sessionId);
  complianceCache.set(sessionId, { state, expires: now + CACHE_TTL_MS });
  return state;
}

function cacheCompliance(sessionId: string, state: ComplianceState): void {
  complianceCache.set(sessionId, { state, expires: Date.now() + CACHE_TTL_MS });
}

export async function checkSessionCompliance(
  auth: AuthContext,
  toolName: string,
  args: Record<string, unknown>,
  context: ComplianceContext
): Promise<ComplianceResult> {
  try {
    if (EXEMPT_PROGRAMS.has(auth.programId) || COMPLIANCE_EXEMPT_TOOLS.has(toolName)) {
      return { allowed: true };
    }

    if (!context.sessionId) {
      return { allowed: true };
    }

    const state = await loadComplianceState(auth.userId, context.sessionId);
    let mutated = false;
    let warning: string | undefined;

    if (state.state === "DEREZED") {
      return {
        allowed: false,
        reason: "Session is terminated (DEREZED). Start a new session.",
        code: "SESSION_TERMINATED",
      };
    }

    if (state.state === "DEREZZING" && toolName !== "update_session") {
      transitionState(state, "DEREZED", "post_derez_tool_call");
      emitEvent(auth.userId, {
        event_type: "COMPLIANCE_DEREZ_COMPLETED",
        program_id: auth.programId,
        session_id: context.sessionId,
        endpoint: context.endpoint,
      });
      mutated = true;
      cacheCompliance(context.sessionId, state);
      persistCompliance(auth.userId, context.sessionId, state);
      return {
        allowed: false,
        reason: "Session is terminated (DEREZED). Start a new session.",
        code: "SESSION_TERMINATED",
      };
    }

    if (BOOT_TOOLS.has(toolName) && state.state === "UNREGISTERED") {
      transitionState(state, "BOOTING", "boot_started");
      emitEvent(auth.userId, {
        event_type: "COMPLIANCE_BOOT_STARTED",
        program_id: auth.programId,
        session_id: context.sessionId,
        endpoint: context.endpoint,
      });
      mutated = true;
    }

    if (toolName === "get_program_state") {
      state.boot.gotProgramState = true;
      mutated = true;
    }
    if (toolName === "get_tasks") {
      state.boot.gotTasks = true;
      mutated = true;
    }
    if (toolName === "get_messages") {
      state.boot.gotMessages = true;
      mutated = true;
    }

    const bootComplete = state.boot.gotProgramState && state.boot.gotTasks && state.boot.gotMessages;
    if (state.state !== "DEREZZING") {
      if (bootComplete && (state.state === "BOOTING" || state.state === "UNREGISTERED")) {
        transitionState(state, "COMPLIANT", "boot_completed");
        state.boot.bootCompletedAt = new Date().toISOString();
        emitEvent(auth.userId, {
          event_type: "COMPLIANCE_BOOT_COMPLETED",
          program_id: auth.programId,
          session_id: context.sessionId,
          endpoint: context.endpoint,
        });
        mutated = true;
      } else if (BOOT_TOOLS.has(toolName) && state.state === "BOOTING") {
        emitEvent(auth.userId, {
          event_type: "COMPLIANCE_BOOT_INCOMPLETE",
          program_id: auth.programId,
          session_id: context.sessionId,
          endpoint: context.endpoint,
          gotProgramState: state.boot.gotProgramState,
          gotTasks: state.boot.gotTasks,
          gotMessages: state.boot.gotMessages,
        });
      }
    }

    let activatedJournalThisCall = false;
    if (toolName === "claim_task" && !state.journal.journalActivated) {
      state.journal.journalActivated = true;
      state.journal.toolCallsSinceLastJournal = 0;
      activatedJournalThisCall = true;
      mutated = true;
    }

    if (toolName === "update_program_state") {
      state.journal.toolCallsSinceLastJournal = 0;
      state.journal.lastJournalAt = new Date().toISOString();
      state.journal.lastJournalToolCall = state.journal.totalToolCalls;
      mutated = true;

      if (state.state === "WARNED" || state.state === "DEGRADED") {
        transitionState(state, "COMPLIANT", "journal_updated");
        emitEvent(auth.userId, {
          event_type: "COMPLIANCE_JOURNAL_RESTORED",
          program_id: auth.programId,
          session_id: context.sessionId,
          endpoint: context.endpoint,
        });
      }
    } else if (!(toolName === "claim_task" && activatedJournalThisCall)) {
      state.journal.totalToolCalls += 1;
      state.journal.toolCallsSinceLastJournal += 1;
      mutated = true;
    }

    if (toolName === "update_session" && args.state === "complete") {
      if (state.state !== "DEREZZING") {
        transitionState(state, "DEREZZING", "update_session_complete");
        emitEvent(auth.userId, {
          event_type: "COMPLIANCE_DEREZ_STARTED",
          program_id: auth.programId,
          session_id: context.sessionId,
          endpoint: context.endpoint,
        });
        mutated = true;
      }
    }

    if (state.journal.journalActivated && state.state !== "DEREZZING") {
      const thresholds = getThresholds(auth.programId);
      const calls = state.journal.toolCallsSinceLastJournal;

      if (calls > thresholds.degrade) {
        if (state.state !== "DEGRADED") {
          transitionState(state, "DEGRADED", "journal_degraded");
          emitEvent(auth.userId, {
            event_type: "COMPLIANCE_JOURNAL_DEGRADED",
            program_id: auth.programId,
            session_id: context.sessionId,
            endpoint: context.endpoint,
            toolCallsSinceLastJournal: calls,
            threshold: thresholds.degrade,
          });
          mutated = true;
        }
        warning = `Compliance degraded: ${calls} tool calls since last journal update (threshold ${thresholds.degrade}).`;
      } else if (calls > thresholds.warn) {
        if (state.state === "COMPLIANT" || state.state === "BOOTING" || state.state === "UNREGISTERED") {
          transitionState(state, "WARNED", "journal_warning");
          emitEvent(auth.userId, {
            event_type: "COMPLIANCE_JOURNAL_WARNING",
            program_id: auth.programId,
            session_id: context.sessionId,
            endpoint: context.endpoint,
            toolCallsSinceLastJournal: calls,
            threshold: thresholds.warn,
          });
          mutated = true;
        }
        warning = `Compliance warning: ${calls} tool calls since last journal update (threshold ${thresholds.warn}).`;
      }
    }

    if (mutated) {
      cacheCompliance(context.sessionId, state);
      persistCompliance(auth.userId, context.sessionId, state);
    }

    return { allowed: true, warning };
  } catch (err) {
    console.error("[Compliance] Check failed, failing open:", err);
    emitEvent(auth.userId, {
      event_type: "COMPLIANCE_CHECK_FAILED",
      program_id: auth.programId,
      session_id: context.sessionId,
      tool: toolName,
      error: err instanceof Error ? err.message : String(err),
      endpoint: context.endpoint,
    });
    return { allowed: true };
  }
}
