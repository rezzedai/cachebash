/**
 * OAuth Scope Definitions — Layer 2
 *
 * Hierarchy: mcp:full = mcp:read + mcp:write
 *            mcp:admin = mcp:full + admin tools
 */

export interface ScopeDefinition {
  scope: string;
  label: string;
  description: string;
  includes?: string[];
}

/** All recognized OAuth scopes */
export const SCOPE_DEFINITIONS: Record<string, ScopeDefinition> = {
  "mcp:full": {
    scope: "mcp:full",
    label: "Full Access",
    description: "Read, write, and manage all tools",
    includes: ["mcp:read", "mcp:write"],
  },
  "mcp:read": {
    scope: "mcp:read",
    label: "Read Only",
    description: "View data without modifications",
  },
  "mcp:write": {
    scope: "mcp:write",
    label: "Read & Write",
    description: "View and modify data",
    includes: ["mcp:read"],
  },
  "mcp:admin": {
    scope: "mcp:admin",
    label: "Admin",
    description: "Full access plus account management",
    includes: ["mcp:full", "mcp:read", "mcp:write"],
  },
};

/** All valid scope strings */
export const VALID_SCOPES = Object.keys(SCOPE_DEFINITIONS);

/**
 * Resolve a scope to its full set of effective scopes (including inherited).
 * e.g., "mcp:admin" → ["mcp:admin", "mcp:full", "mcp:read", "mcp:write"]
 */
export function resolveScopes(scope: string): string[] {
  const resolved = new Set<string>();

  function resolve(s: string) {
    if (resolved.has(s)) return;
    resolved.add(s);
    const def = SCOPE_DEFINITIONS[s];
    if (def?.includes) {
      for (const inc of def.includes) resolve(inc);
    }
  }

  for (const s of scope.split(" ")) {
    if (SCOPE_DEFINITIONS[s]) resolve(s);
  }

  return Array.from(resolved);
}

/**
 * Validate that all scopes in a space-separated string are recognized.
 * Returns { valid: true, scopes } or { valid: false, invalid }.
 */
export function validateScopes(scope: string): { valid: true; scopes: string[] } | { valid: false; invalid: string[] } {
  const scopes = scope.split(" ").filter(Boolean);
  const invalid = scopes.filter((s) => !SCOPE_DEFINITIONS[s]);
  if (invalid.length > 0) return { valid: false, invalid };
  return { valid: true, scopes };
}

/**
 * Check if a set of granted scopes satisfies a required scope.
 * Accounts for hierarchy: mcp:full satisfies mcp:read.
 */
export function hasScope(grantedScopes: string[], required: string): boolean {
  // Expand all granted scopes to their effective scopes
  const effective = new Set<string>();
  for (const s of grantedScopes) {
    for (const r of resolveScopes(s)) {
      effective.add(r);
    }
  }
  return effective.has(required);
}

/**
 * Map tool names to their required OAuth scope.
 * Read-only tools → mcp:read, write tools → mcp:write, admin tools → mcp:admin.
 */
export const TOOL_SCOPE_MAP: Record<string, string> = {
  // Read-only tools → mcp:read
  get_tasks: "mcp:read",
  get_messages: "mcp:read",
  get_dead_letters: "mcp:read",
  list_groups: "mcp:read",
  get_sent_messages: "mcp:read",
  query_message_history: "mcp:read",
  list_sessions: "mcp:read",
  get_response: "mcp:read",
  dream_peek: "mcp:read",
  get_sprint: "mcp:read",
  list_keys: "mcp:read",
  get_audit: "mcp:read",
  get_program_state: "mcp:read",
  get_cost_summary: "mcp:read",
  get_comms_metrics: "mcp:read",
  get_operational_metrics: "mcp:read",
  get_fleet_health: "mcp:read",
  query_traces: "mcp:read",
  query_trace: "mcp:read",

  // Write tools → mcp:write
  create_task: "mcp:write",
  claim_task: "mcp:write",
  complete_task: "mcp:write",
  send_message: "mcp:write",
  create_session: "mcp:write",
  update_session: "mcp:write",
  ask_question: "mcp:write",
  send_alert: "mcp:write",
  dream_activate: "mcp:write",
  create_sprint: "mcp:write",
  update_sprint_story: "mcp:write",
  add_story_to_sprint: "mcp:write",
  complete_sprint: "mcp:write",
  update_program_state: "mcp:write",
  submit_feedback: "mcp:write",

  // Admin tools → mcp:admin
  create_key: "mcp:admin",
  revoke_key: "mcp:admin",
};

/**
 * Check if OAuth scopes permit a tool invocation.
 * Returns null if allowed, or an error string if denied.
 * Non-OAuth auth (API keys) bypass this check entirely.
 */
export function checkToolScope(toolName: string, grantedScopes: string[]): string | null {
  const required = TOOL_SCOPE_MAP[toolName];
  if (!required) return null; // Unknown tool or no scope requirement
  if (hasScope(grantedScopes, required)) return null;
  return `insufficient_scope: "${toolName}" requires "${required}"`;
}

/**
 * Get scope definitions for display on consent screen.
 */
export function getScopeDisplayInfo(scopes: string[]): Array<{ scope: string; label: string; description: string }> {
  return scopes
    .map((s) => SCOPE_DEFINITIONS[s])
    .filter(Boolean)
    .map(({ scope, label, description }) => ({ scope, label, description }));
}
