/**
 * Capability-Based Access Control — Phase 4 Wave 2
 *
 * Maps tools to required capabilities and enforces access.
 * Capabilities use module.action pattern (e.g., "dispatch.read").
 * Wildcard "*" grants unrestricted access.
 */

import { resolveToolAlias } from "../tools/tool-aliases.js";

/** All valid capability strings */
export type Capability =
  | "*"
  | "dispatch.read" | "dispatch.write"
  | "relay.read" | "relay.write"
  | "pulse.read" | "pulse.write"
  | "signal.read" | "signal.write"
  | "dream.read" | "dream.write"
  | "sprint.read" | "sprint.write"
  | "keys.read" | "keys.write"
  // keys.provision: explicit, owner-equivalent grant to CREATE keys. Checked by
  // literal membership in auth/ownerAuthz (never implied by "*"); not in any
  // DEFAULT_CAPABILITIES role — must be granted by name.
  | "keys.provision"
  | "audit.read"
  | "state.read" | "state.write"
  | "metrics.read"
  | "fleet.read"
  // fleet.control: quarantine/unquarantine programs — hard-denied for wingman tier
  | "fleet.control"
  | "trace.read"
  | "programs.read" | "programs.write"
  | "gsp.read" | "gsp.write"
  // admin.write: account admin operations — hard-denied for wingman tier
  | "admin.write"
  // policy.read/write: Gate policy management — hard-denied for wingman tier
  | "policy.read" | "policy.write"
  // webhooks.read/write: distinct from relay.* so wingman (which has relay.*) cannot reach webhook infrastructure
  | "webhooks.read" | "webhooks.write";

/** Map every tool name to its required capability */
export const TOOL_CAPABILITIES: Record<string, Capability> = {
  // Dispatch
  dispatch_get_tasks: "dispatch.read",
  dispatch_get_task_by_id: "dispatch.read",
  dispatch_create_task: "dispatch.write",
  dispatch_claim_task: "dispatch.write",
  dispatch_unclaim_task: "dispatch.write",
  dispatch_complete_task: "dispatch.write",
  dispatch_record_task_telemetry: "dispatch.write",
  dispatch_batch_claim_tasks: "dispatch.write",
  dispatch_batch_complete_tasks: "dispatch.write",
  dispatch_get_contention_metrics: "dispatch.read",
  dispatch_dispatch: "dispatch.write",
  dispatch_retry_task: "dispatch.write",
  dispatch_abort_task: "dispatch.write",
  dispatch_reassign_task: "dispatch.write",
  dispatch_escalate_task: "dispatch.write",
  dispatch_replay_task: "dispatch.write",
  dispatch_approve_task: "dispatch.write",
  dispatch_export_tasks: "dispatch.read",
  dispatch_suggest_target: "dispatch.read",
  dispatch_get_task_lineage: "dispatch.read",
  // Fleet control — hard-deny for wingman tier
  dispatch_quarantine_program: "fleet.control",
  dispatch_unquarantine_program: "fleet.control",
  // Relay
  relay_send_message: "relay.write",
  relay_get_messages: "relay.read",
  relay_get_dead_letters: "relay.read",
  relay_list_groups: "relay.read",
  relay_get_sent_messages: "relay.read",
  relay_query_message_history: "relay.read",
  relay_send_directive: "relay.write",
  // REST-only: POST /v1/messages/mark_read mutates relay message read-state
  // directly (no MCP tool handler) — mapped here purely for capability +
  // circuit-breaker gating via enforceBreaker() in rest.ts.
  relay_mark_read: "relay.write",
  // Pulse
  pulse_create_session: "pulse.write",
  pulse_update_session: "pulse.write",
  pulse_list_sessions: "pulse.read",
  pulse_get_fleet_health: "fleet.read",
  pulse_get_fleet_timeline: "fleet.read",
  pulse_pause_program: "pulse.write",
  pulse_resume_program: "pulse.write",
  pulse_write_fleet_snapshot: "pulse.write",
  pulse_get_context_utilization: "pulse.read",
  // Signal
  signal_ask_question: "signal.write",
  signal_get_response: "signal.read",
  signal_send_alert: "signal.write",
  // Dream
  dream_peek: "dream.read",
  dream_activate: "dream.write",
  // Sprint
  sprint_create_sprint: "sprint.write",
  sprint_update_sprint_story: "sprint.write",
  sprint_add_story_to_sprint: "sprint.write",
  sprint_complete_sprint: "sprint.write",
  sprint_get_sprint: "sprint.read",
  // Keys
  keys_create_key: "keys.write",
  keys_revoke_key: "keys.write",
  keys_rotate_key: "keys.write",
  keys_list_keys: "keys.read",
  // Audit
  audit_get_audit: "audit.read",
  audit_get_ack_compliance: "audit.read",
  // Program State
  state_get_program_state: "state.read",
  state_update_program_state: "state.write",
  state_get_context_history: "state.read",
  state_store_memory: "state.write",
  state_recall_memory: "state.read",
  state_memory_health: "state.read",
  state_delete_memory: "state.write",
  state_reinforce_memory: "state.write",
  // Metrics
  metrics_get_cost_summary: "metrics.read",
  metrics_get_comms_metrics: "metrics.read",
  metrics_get_operational_metrics: "metrics.read",
  metrics_log_rate_limit_event: "metrics.read",
  metrics_get_rate_limit_events: "metrics.read",
  metrics_get_cost_forecast: "metrics.read",
  metrics_get_sla_compliance: "metrics.read",
  metrics_get_program_health: "metrics.read",
  // Trace
  trace_query_traces: "trace.read",
  trace_query_trace: "trace.read",
  // Programs
  programs_list_programs: "programs.read",
  programs_update_program: "programs.write",
  // Feedback — SARK ruling 2026-06-17: relay.write (tenant-isolated write, no dispatch side effects)
  feedback_submit_feedback: "relay.write",
  // Admin — hard-deny for wingman tier
  admin_merge_accounts: "admin.write",
  // Usage (internal/hidden)
  usage_get_usage: "metrics.read",
  usage_get_invoice: "metrics.read",
  usage_set_budget: "dispatch.write",
  // Policy — hard-deny for wingman tier
  policy_create: "policy.write",
  policy_update: "policy.write",
  policy_delete: "policy.write",
  policy_get: "policy.read",
  policy_list: "policy.read",
  policy_check: "policy.read",
  // Webhooks — uses webhooks.* NOT relay.* to prevent wingman (which has relay.*) from registering exfiltration callbackUrls
  webhook_register: "webhooks.write",
  webhook_list: "webhooks.read",
  webhook_delete: "webhooks.write",
  webhook_get_deliveries: "webhooks.read",
  // CLU (enrichment/analytics — full profile only)
  clu_ingest: "state.write",
  clu_analyze: "state.read",
  clu_report: "state.read",
  // Schedule (enrichment/analytics — full profile only)
  schedule_create: "pulse.write",
  schedule_list: "pulse.read",
  schedule_get: "pulse.read",
  schedule_update: "pulse.write",
  schedule_delete: "pulse.write",
  // Pattern consolidation (enrichment/analytics — full profile only)
  pattern_consolidate: "state.write",
  pattern_get_consolidated: "state.read",
  // Request Help (lite profile only — tenant→home-grid egress)
  request_help: "relay.write",
  // GSP (Grid State Protocol)
  gsp_read: "gsp.read",
  gsp_write: "gsp.write",
  gsp_diff: "gsp.read",
  gsp_bootstrap: "gsp.write",
  gsp_seed: "gsp.write",
  gsp_propose: "gsp.write",
  gsp_subscribe: "gsp.read",
  gsp_resolve: "gsp.write",
  gsp_search: "gsp.read",
};

/** Default capabilities for each program role */
export const DEFAULT_CAPABILITIES: Record<string, Capability[]> = {
  orchestrator: ["*"],
  admin: ["*"],
  legacy: ["*"],
  mobile: [
    "dispatch.read", "dispatch.write",
    "relay.read", "relay.write",
    "pulse.read",
    "signal.read", "signal.write",
    "fleet.read", "metrics.read", "sprint.read",
    "programs.read",
    "gsp.read",
    "webhooks.read", "webhooks.write",
  ],
  // Builder programs — standard operational set
  builder: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  architect: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  auditor: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "audit.read", "programs.read", "programs.write",
    "gsp.read", "webhooks.read"],
  reviewer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  designer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "webhooks.read", "webhooks.write"],
  growth: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "webhooks.read", "webhooks.write"],
  ops: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  memory: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  strategist: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "webhooks.read", "webhooks.write"],
  // OAuth external clients — read-only fallback (C-1); fallback sites in callback.ts/token.ts still mint tokens, but these caps are powerless to mutate
  oauth: ["dispatch.read", "relay.read", "pulse.read", "signal.read",
    "sprint.read", "metrics.read", "fleet.read", "programs.read",
    "gsp.read", "state.read", "webhooks.read"],
  // OAuth service accounts (client_credentials) — same as oauth
  "oauth-service": ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write", "webhooks.read", "webhooks.write"],
  // SCALAR — Flynn's web/mobile Grid identity (OAuth-bound, claude.ai connector).
  // Explicit minted set: operational read+write, observability read-only.
  // Deliberately NO keys.*, NO audit, NO programs.write, NO wildcard.
  scalar: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "gsp.read", "gsp.write", "state.read", "state.write",
    "sprint.read", "metrics.read", "fleet.read", "programs.read",
    "webhooks.read", "webhooks.write"],
  // Grid programs — full operational access
  iso: ["*"],
  basher: ["*"],
  alan: ["*"],
  sark: ["*"],
  quorra: ["*"],
  casp: ["*"],
  ram: ["*"],
  radia: ["*"],
  castor: ["*"],
  vector: ["*"],
  bit: ["*"],
  dispatcher: ["*"],
  // Wingman tier — least-privilege identity spine for Flynn's day-job agents.
  // ALLOWED: dispatch + relay + signal (orchestrate + coordinate) + result reads.
  // HARD-DENY (absent, not just execution-denied): keys.*, admin.write, fleet.control,
  // policy.*, gsp.write (governance resolution), fleet.read (fleet control reads),
  // audit.*, state.write, programs.write. A wingman key can dispatch work,
  // coordinate, and read results — nothing that touches keys, admin, fleet, or policy.
  wingman: [
    "dispatch.read", "dispatch.write",
    "relay.read", "relay.write",
    "signal.read", "signal.write",
    "state.read",
    "pulse.read",
    "programs.read",
  ],
  // External users — restricted, no admin/audit/keys/state-write
  default: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "signal.read", "signal.write",
    "sprint.read", "metrics.read", "fleet.read", "programs.read",
    "webhooks.read", "webhooks.write"],
};

/**
 * Check if a set of capabilities includes the required capability.
 * Supports wildcard: ["*"] grants access to everything.
 */
export function hasCapability(capabilities: string[], required: Capability): boolean {
  if (capabilities.includes("*")) return true;
  return capabilities.includes(required);
}

/**
 * Check capability for a tool invocation.
 * Returns { allowed: true } or { allowed: false, required, held }.
 */
export function checkToolCapability(
  toolName: string,
  capabilities: string[]
): { allowed: true } | { allowed: false; required: string; held: string[] } {
  // Resolve alias to canonical name before lookup
  const canonical = resolveToolAlias(toolName);
  const required = TOOL_CAPABILITIES[canonical];
  if (!required) {
    // Unknown/unmapped tool — fail-CLOSED for restricted profiles; wildcard holders pass through.
    // This prevents a future unmapped tool from silently granting access to wingman-tier callers.
    if (capabilities.includes("*")) return { allowed: true };
    return { allowed: false, required: "unmapped", held: capabilities };
  }
  if (hasCapability(capabilities, required)) {
    return { allowed: true };
  }
  return { allowed: false, required, held: capabilities };
}

/**
 * G-2: Filter tool definitions to only those the caller's capabilities entitle them to see.
 * Tools in TOOL_CAPABILITIES are filtered by their required capability.
 * Wildcard ["*"] holders see all tools unfiltered.
 * Tools NOT mapped in TOOL_CAPABILITIES are HIDDEN from restricted callers (fail-CLOSED)
 * so a future unmapped tool cannot silently appear in a wingman-tier tools/list.
 */
export function filterToolsByCapabilities<T extends { name: string }>(
  toolDefs: T[],
  capabilities: string[]
): T[] {
  if (capabilities.includes("*")) return toolDefs;
  return toolDefs.filter(tool => {
    const required = TOOL_CAPABILITIES[tool.name];
    if (!required) return false; // unmapped tool — fail-closed for restricted profiles
    return capabilities.includes(required);
  });
}

/**
 * Get default capabilities for a program.
 * Fail-closed: unknown programs get no capabilities.
 */
export function getDefaultCapabilities(programId: string): Capability[] {
  const caps = DEFAULT_CAPABILITIES[programId];
  if (!caps) {
    console.warn(`[Capabilities] Unknown programId "${programId}" — falling back to default capabilities`);
    return DEFAULT_CAPABILITIES["default"] || [];
  }
  return caps;
}
