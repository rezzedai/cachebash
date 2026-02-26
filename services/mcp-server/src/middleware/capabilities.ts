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
  | "trace.read";

/** Map every tool name to its required capability */
export const TOOL_CAPABILITIES: Record<string, Capability> = {
  // Dispatch
  get_tasks: "dispatch.read",
  create_task: "dispatch.write",
  claim_task: "dispatch.write",
  complete_task: "dispatch.write",
  // Relay
  send_message: "relay.write",
  get_messages: "relay.read",
  get_dead_letters: "relay.read",
  list_groups: "relay.read",
  get_sent_messages: "relay.read",
  query_message_history: "relay.read",
  // Pulse
  create_session: "pulse.write",
  update_session: "pulse.write",
  list_sessions: "pulse.read",
  // Signal
  ask_question: "signal.write",
  get_response: "signal.read",
  send_alert: "signal.write",
  // Dream
  dream_peek: "dream.read",
  dream_activate: "dream.write",
  // Sprint
  create_sprint: "sprint.write",
  update_sprint_story: "sprint.write",
  add_story_to_sprint: "sprint.write",
  complete_sprint: "sprint.write",
  get_sprint: "sprint.read",
  // Keys
  create_key: "keys.write",
  revoke_key: "keys.write",
  list_keys: "keys.read",
  // Audit
  get_audit: "audit.read",
  // Program State
  get_program_state: "state.read",
  update_program_state: "state.write",
  // Metrics
  get_cost_summary: "metrics.read",
  get_comms_metrics: "metrics.read",
  get_operational_metrics: "metrics.read",
  // Fleet
  get_fleet_health: "fleet.read",
  // Trace
  query_traces: "trace.read",
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
  ],
  // Builder programs — standard operational set
  builder: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  architect: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  auditor: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read", "audit.read"],
  reviewer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  designer: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  growth: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  ops: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  memory: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  strategist: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  // OAuth external clients — standard operational access, no admin
  oauth: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "pulse.write", "signal.read", "signal.write",
    "state.read", "state.write", "sprint.read"],
  // External users — restricted, no admin/audit/keys/state-write
  default: ["dispatch.read", "dispatch.write", "relay.read", "relay.write",
    "pulse.read", "signal.read", "signal.write",
    "sprint.read", "metrics.read", "fleet.read"],
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
    console.warn(`[Capabilities] Unknown programId "${programId}" — returning empty capabilities`);
    return [];
  }
  return caps;
}
