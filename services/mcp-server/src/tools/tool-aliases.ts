/**
 * Backward-Compatible Tool Aliases
 *
 * Maps old flat names and legacy aliases to their new domain-prefixed canonical names.
 * After the domain prefix migration, canonical tool names are domain-prefixed
 * (e.g., dispatch_create_task, relay_send_message). Old flat names (e.g., create_task,
 * send_message) resolve to canonical via this alias map.
 *
 * Both alias and canonical names are valid — aliases resolve to canonical
 * before middleware (rate limiting, capabilities, scopes) runs.
 *
 * Tools already domain-prefixed (gsp_*, clu_*, dream_*, pattern_*) are omitted
 * since their canonical names never changed.
 */

/**
 * Alias -> canonical tool name mapping.
 * Maps old flat names and legacy shorthand aliases to new domain-prefixed canonical names.
 */
export const TOOL_ALIASES: Record<string, string> = {
  // Dispatch domain — backward compat for old flat names
  get_tasks: "dispatch_get_tasks",
  get_task_by_id: "dispatch_get_task_by_id",
  create_task: "dispatch_create_task",
  claim_task: "dispatch_claim_task",
  unclaim_task: "dispatch_unclaim_task",
  complete_task: "dispatch_complete_task",
  batch_claim_tasks: "dispatch_batch_claim_tasks",
  batch_complete_tasks: "dispatch_batch_complete_tasks",
  get_contention_metrics: "dispatch_get_contention_metrics",
  dispatch: "dispatch_dispatch",
  retry_task: "dispatch_retry_task",
  abort_task: "dispatch_abort_task",
  reassign_task: "dispatch_reassign_task",
  escalate_task: "dispatch_escalate_task",
  quarantine_program: "dispatch_quarantine_program",
  unquarantine_program: "dispatch_unquarantine_program",
  replay_task: "dispatch_replay_task",
  approve_task: "dispatch_approve_task",
  // Old aliases that differ from new canonical
  dispatch_batch_claim: "dispatch_batch_claim_tasks",
  dispatch_batch_complete: "dispatch_batch_complete_tasks",
  dispatch_get_contention: "dispatch_get_contention_metrics",

  // Relay domain
  send_message: "relay_send_message",
  get_messages: "relay_get_messages",
  get_dead_letters: "relay_get_dead_letters",
  list_groups: "relay_list_groups",
  get_sent_messages: "relay_get_sent_messages",
  query_message_history: "relay_query_message_history",
  send_directive: "relay_send_directive",
  // Old aliases
  relay_send: "relay_send_message",
  relay_get_sent: "relay_get_sent_messages",
  relay_query_history: "relay_query_message_history",

  // Pulse domain
  create_session: "pulse_create_session",
  update_session: "pulse_update_session",
  list_sessions: "pulse_list_sessions",
  get_fleet_health: "pulse_get_fleet_health",
  get_fleet_timeline: "pulse_get_fleet_timeline",
  write_fleet_snapshot: "pulse_write_fleet_snapshot",
  get_context_utilization: "pulse_get_context_utilization",
  // Old aliases
  session_create: "pulse_create_session",
  session_update: "pulse_update_session",
  session_list: "pulse_list_sessions",
  fleet_health: "pulse_get_fleet_health",
  fleet_timeline: "pulse_get_fleet_timeline",
  fleet_write_snapshot: "pulse_write_fleet_snapshot",
  fleet_get_context: "pulse_get_context_utilization",

  // Signal domain
  ask_question: "signal_ask_question",
  get_response: "signal_get_response",
  send_alert: "signal_send_alert",
  // Old aliases
  signal_ask: "signal_ask_question",
  signal_alert: "signal_send_alert",

  // Sprint domain
  create_sprint: "sprint_create_sprint",
  update_sprint_story: "sprint_update_sprint_story",
  add_story_to_sprint: "sprint_add_story_to_sprint",
  complete_sprint: "sprint_complete_sprint",
  get_sprint: "sprint_get_sprint",
  // Old aliases
  sprint_create: "sprint_create_sprint",
  sprint_update_story: "sprint_update_sprint_story",
  sprint_add_story: "sprint_add_story_to_sprint",
  sprint_complete: "sprint_complete_sprint",
  sprint_get: "sprint_get_sprint",

  // Keys domain
  create_key: "keys_create_key",
  revoke_key: "keys_revoke_key",
  rotate_key: "keys_rotate_key",
  list_keys: "keys_list_keys",
  // Old aliases
  keys_create: "keys_create_key",
  keys_revoke: "keys_revoke_key",
  keys_rotate: "keys_rotate_key",
  keys_list: "keys_list_keys",

  // Programs domain
  list_programs: "programs_list_programs",
  update_program: "programs_update_program",
  // Old aliases
  registry_list: "programs_list_programs",
  registry_update: "programs_update_program",

  // Audit domain
  get_audit: "audit_get_audit",
  get_ack_compliance: "audit_get_ack_compliance",
  // Old aliases
  audit_query: "audit_get_audit",
  audit_ack_compliance: "audit_get_ack_compliance",

  // State domain (programState)
  get_program_state: "state_get_program_state",
  update_program_state: "state_update_program_state",
  get_context_history: "state_get_context_history",
  store_memory: "state_store_memory",
  recall_memory: "state_recall_memory",
  memory_health: "state_memory_health",
  delete_memory: "state_delete_memory",
  reinforce_memory: "state_reinforce_memory",
  // Old aliases
  state_get: "state_get_program_state",
  state_update: "state_update_program_state",

  // Metrics domain
  get_cost_summary: "metrics_get_cost_summary",
  get_comms_metrics: "metrics_get_comms_metrics",
  get_operational_metrics: "metrics_get_operational_metrics",
  log_rate_limit_event: "metrics_log_rate_limit_event",
  get_rate_limit_events: "metrics_get_rate_limit_events",
  get_cost_forecast: "metrics_get_cost_forecast",
  get_sla_compliance: "metrics_get_sla_compliance",
  get_program_health: "metrics_get_program_health",
  // Old aliases
  metrics_cost: "metrics_get_cost_summary",
  metrics_comms: "metrics_get_comms_metrics",
  metrics_ops: "metrics_get_operational_metrics",
  metrics_log_rate_limit: "metrics_log_rate_limit_event",
  metrics_get_rate_limits: "metrics_get_rate_limit_events",
  metrics_forecast: "metrics_get_cost_forecast",
  metrics_sla: "metrics_get_sla_compliance",
  metrics_health: "metrics_get_program_health",

  // Usage domain
  get_usage: "usage_get_usage",
  get_invoice: "usage_get_invoice",
  set_budget: "usage_set_budget",
  // Old aliases
  usage_get: "usage_get_usage",

  // Trace domain
  query_traces: "trace_query_traces",
  query_trace: "trace_query_trace",
  // Old aliases
  trace_query: "trace_query_traces",
  trace_get: "trace_query_trace",

  // Feedback domain
  submit_feedback: "feedback_submit_feedback",
  // Old alias
  feedback_submit: "feedback_submit_feedback",

  // Admin domain
  merge_accounts: "admin_merge_accounts",
};

/** Reverse map: canonical -> alias (for description generation) */
const CANONICAL_TO_ALIAS = new Map<string, string>();
for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
  CANONICAL_TO_ALIAS.set(canonical, alias);
}

/**
 * Resolve a tool name to its canonical form.
 * If the name is an alias, returns the canonical name.
 * If already canonical (or unknown), returns as-is.
 */
export function resolveToolAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/**
 * Get the old flat alias for a canonical tool name, if one exists.
 */
export function getToolAlias(canonical: string): string | undefined {
  return CANONICAL_TO_ALIAS.get(canonical);
}
