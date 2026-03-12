/**
 * Capability-Based Access Control — Phase 4 Wave 2
 *
 * Maps tools to required capabilities and enforces access.
 * Capabilities use module.action pattern (e.g., "dispatch.read").
 * Wildcard "*" grants unrestricted access.
 */

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
  | "audit.read"
  | "state.read" | "state.write"
  | "metrics.read"
  | "fleet.read"
  | "trace.read"
  | "programs.read" | "programs.write"
  | "gsp.read" | "gsp.write";

/** Map every tool name to its required capability */
export const TOOL_CAPABILITIES: Record<string, Capability> = {
  // Dispatch
  dispatch_get_tasks: "dispatch.read",
  dispatch_get_task_by_id: "dispatch.read",
  dispatch_create_task: "dispatch.write",
  dispatch_claim_task: "dispatch.write",
  dispatch_unclaim_task: "dispatch.write",
  dispatch_complete_task: "dispatch.write",
  dispatch_batch_claim_tasks: "dispatch.write",
  dispatch_batch_complete_tasks: "dispatch.write",
  dispatch_get_contention_metrics: "dispatch.read",
  // Relay
  relay_send_message: "relay.write",
  relay_get_messages: "relay.read",
  relay_get_dead_letters: "relay.read",
  relay_list_groups: "relay.read",
  relay_get_sent_messages: "relay.read",
  relay_query_message_history: "relay.read",
  relay_send_directive: "relay.write",
  // Pulse
  pulse_create_session: "pulse.write",
  pulse_update_session: "pulse.write",
  pulse_list_sessions: "pulse.read",
  pulse_get_fleet_health: "fleet.read",
  pulse_get_fleet_timeline: "fleet.read",
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
  // Trace
  trace_query_traces: "trace.read",
  trace_query_trace: "trace.read",
  // Programs
  programs_list_programs: "programs.read",
  programs_update_program: "programs.write",
  // Feedback
  feedback_submit_feedback: "dispatch.write",
  // Admin
  admin_merge_accounts: "dispatch.write",
  // Usage (internal/hidden)
  usage_get_usage: "metrics.read",
  usage_get_invoice: "metrics.read",
  usage_set_budget: "dispatch.write",
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
  ],
  // Builder programs — standard operational set
  builder: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  architect: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  auditor: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "audit.read", "programs.read", "programs.write",
    "gsp.read"],
  reviewer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  designer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read"],
  growth: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read"],
  ops: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  memory: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  strategist: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read"],
  // OAuth external clients — standard operational access, no admin
  oauth: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
  // OAuth service accounts (client_credentials) — same as oauth
  "oauth-service": ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "programs.read", "programs.write",
    "gsp.read", "gsp.write"],
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
  // External users — restricted, no admin/audit/keys/state-write
  default: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "signal.read", "signal.write",
    "sprint.read", "metrics.read", "fleet.read", "programs.read"],
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
  const required = TOOL_CAPABILITIES[toolName];
  if (!required) {
    // Unknown tool — let the handler deal with it
    return { allowed: true };
  }
  if (hasCapability(capabilities, required)) {
    return { allowed: true };
  }
  return { allowed: false, required, held: capabilities };
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
