/**
 * Wingman tier tests — capability profile + G-2 tools/list topology hiding.
 *
 * Three invariants:
 *  (a) A wingman key lists ONLY its entitled tools (zero admin_, keys_ names)
 *  (b) A wingman key cannot execute a redacted tool (capability-gate regression)
 *  (c) Full/lite tiers are UNAFFECTED by the G-2 filter
 */

import {
  DEFAULT_CAPABILITIES,
  TOOL_CAPABILITIES,
  checkToolCapability,
  filterToolsByCapabilities,
  getDefaultCapabilities,
} from '../middleware/capabilities';

const WINGMAN_CAPS = DEFAULT_CAPABILITIES['wingman'];

// Minimal tool definition shape (matches MCP SDK Tool type)
type ToolDef = { name: string; description: string; inputSchema: object };

function makeTool(name: string): ToolDef {
  return { name, description: '', inputSchema: {} };
}

// Full simulated tool list — representative sample of all capability classes
const ALL_TOOLS: ToolDef[] = [
  // dispatch (wingman can see)
  makeTool('dispatch_get_tasks'),
  makeTool('dispatch_create_task'),
  makeTool('dispatch_claim_task'),
  makeTool('dispatch_complete_task'),
  makeTool('dispatch_dispatch'),
  // relay (wingman can see)
  makeTool('relay_send_message'),
  makeTool('relay_get_messages'),
  // signal (wingman can see)
  makeTool('signal_ask_question'),
  makeTool('signal_send_alert'),
  // state read (wingman can see)
  makeTool('state_get_program_state'),
  makeTool('state_recall_memory'),
  // pulse read (wingman can see)
  makeTool('pulse_list_sessions'),
  makeTool('pulse_get_context_utilization'),
  // programs read (wingman can see)
  makeTool('programs_list_programs'),
  // keys (HARD-DENY — must be absent)
  makeTool('keys_create_key'),
  makeTool('keys_revoke_key'),
  makeTool('keys_rotate_key'),
  makeTool('keys_list_keys'),
  // admin (HARD-DENY — must be absent)
  makeTool('admin_merge_accounts'),
  // fleet control (HARD-DENY — must be absent)
  makeTool('dispatch_quarantine_program'),
  makeTool('dispatch_unquarantine_program'),
  // policy (HARD-DENY — must be absent)
  makeTool('policy_create'),
  makeTool('policy_update'),
  makeTool('policy_delete'),
  makeTool('policy_get'),
  makeTool('policy_list'),
  makeTool('policy_check'),
  // gsp write (HARD-DENY — must be absent)
  makeTool('gsp_resolve'),
  makeTool('gsp_propose'),
  makeTool('gsp_write'),
  makeTool('gsp_bootstrap'),
  makeTool('gsp_seed'),
  // audit (must be absent)
  makeTool('audit_get_audit'),
  makeTool('audit_get_ack_compliance'),
  // state write (must be absent)
  makeTool('state_update_program_state'),
  makeTool('state_store_memory'),
  // pulse write / fleet control (must be absent)
  makeTool('pulse_pause_program'),
  makeTool('pulse_resume_program'),
  makeTool('pulse_write_fleet_snapshot'),
  // webhooks (HARD-DENY — exfiltration risk; distinct from relay.*)
  makeTool('webhook_register'),
  makeTool('webhook_list'),
  makeTool('webhook_delete'),
  makeTool('webhook_get_deliveries'),
  // metrics extended (HARD-DENY — wingman has no metrics.read)
  makeTool('metrics_get_cost_forecast'),
  makeTool('metrics_get_sla_compliance'),
  makeTool('metrics_get_program_health'),
];

// Module-level wingman view (used by multiple describe blocks below)
const wingmanView = filterToolsByCapabilities(ALL_TOOLS, WINGMAN_CAPS);

const HARD_DENY_TOOLS = [
  'keys_create_key', 'keys_revoke_key', 'keys_rotate_key', 'keys_list_keys',
  'admin_merge_accounts',
  'dispatch_quarantine_program', 'dispatch_unquarantine_program',
  'policy_create', 'policy_update', 'policy_delete',
  'gsp_resolve', 'gsp_propose', 'gsp_write', 'gsp_bootstrap', 'gsp_seed',
  'audit_get_audit', 'audit_get_ack_compliance',
  'state_update_program_state', 'state_store_memory',
  'pulse_pause_program', 'pulse_resume_program', 'pulse_write_fleet_snapshot',
  // webhooks — exfiltration vector; must be absent even though wingman has relay.*
  'webhook_register', 'webhook_list', 'webhook_delete', 'webhook_get_deliveries',
  // metrics extended — wingman lacks metrics.read
  'metrics_get_cost_forecast', 'metrics_get_sla_compliance', 'metrics_get_program_health',
];

describe('Wingman tier — capability profile', () => {
  it('wingman profile exists in DEFAULT_CAPABILITIES', () => {
    expect(WINGMAN_CAPS).toBeDefined();
    expect(Array.isArray(WINGMAN_CAPS)).toBe(true);
  });

  it('wingman has no wildcard', () => {
    expect(WINGMAN_CAPS).not.toContain('*');
  });

  it('wingman can dispatch and coordinate', () => {
    expect(WINGMAN_CAPS).toContain('dispatch.read');
    expect(WINGMAN_CAPS).toContain('dispatch.write');
    expect(WINGMAN_CAPS).toContain('relay.read');
    expect(WINGMAN_CAPS).toContain('relay.write');
    expect(WINGMAN_CAPS).toContain('signal.read');
    expect(WINGMAN_CAPS).toContain('signal.write');
  });

  it('wingman can read results (state.read, pulse.read, programs.read)', () => {
    expect(WINGMAN_CAPS).toContain('state.read');
    expect(WINGMAN_CAPS).toContain('pulse.read');
    expect(WINGMAN_CAPS).toContain('programs.read');
  });

  it('HARD-DENY: wingman has no keys capabilities', () => {
    expect(WINGMAN_CAPS).not.toContain('keys.read');
    expect(WINGMAN_CAPS).not.toContain('keys.write');
    expect(WINGMAN_CAPS).not.toContain('keys.provision');
  });

  it('HARD-DENY: wingman has no admin capabilities', () => {
    expect(WINGMAN_CAPS).not.toContain('admin.write');
  });

  it('HARD-DENY: wingman has no fleet control capability', () => {
    expect(WINGMAN_CAPS).not.toContain('fleet.control');
    expect(WINGMAN_CAPS).not.toContain('fleet.read');
  });

  it('HARD-DENY: wingman has no gsp write capability (governance resolution)', () => {
    expect(WINGMAN_CAPS).not.toContain('gsp.write');
  });

  it('HARD-DENY: wingman has no policy capabilities', () => {
    expect(WINGMAN_CAPS).not.toContain('policy.read');
    expect(WINGMAN_CAPS).not.toContain('policy.write');
  });

  it('HARD-DENY: wingman has no audit, state-write, or pulse-write', () => {
    expect(WINGMAN_CAPS).not.toContain('audit.read');
    expect(WINGMAN_CAPS).not.toContain('state.write');
    expect(WINGMAN_CAPS).not.toContain('pulse.write');
    expect(WINGMAN_CAPS).not.toContain('programs.write');
    expect(WINGMAN_CAPS).not.toContain('metrics.read');
    expect(WINGMAN_CAPS).not.toContain('gsp.read');
  });

  it('getDefaultCapabilities("wingman") returns wingman profile', () => {
    expect(getDefaultCapabilities('wingman')).toEqual(WINGMAN_CAPS);
  });
});

describe('Wingman tier — execution gate (b)', () => {
  it('dispatch_create_task is allowed', () => {
    expect(checkToolCapability('dispatch_create_task', WINGMAN_CAPS).allowed).toBe(true);
  });

  it('relay_send_message is allowed', () => {
    expect(checkToolCapability('relay_send_message', WINGMAN_CAPS).allowed).toBe(true);
  });

  it('HARD-DENY: keys_create_key is denied', () => {
    const r = checkToolCapability('keys_create_key', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('keys.write');
  });

  it('HARD-DENY: keys_list_keys is denied', () => {
    const r = checkToolCapability('keys_list_keys', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('keys.read');
  });

  it('HARD-DENY: admin_merge_accounts is denied (requires admin.write)', () => {
    const r = checkToolCapability('admin_merge_accounts', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('admin.write');
  });

  it('HARD-DENY: dispatch_quarantine_program is denied (requires fleet.control)', () => {
    const r = checkToolCapability('dispatch_quarantine_program', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('fleet.control');
  });

  it('HARD-DENY: dispatch_unquarantine_program is denied (requires fleet.control)', () => {
    const r = checkToolCapability('dispatch_unquarantine_program', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('fleet.control');
  });

  it('HARD-DENY: gsp_resolve is denied (requires gsp.write)', () => {
    const r = checkToolCapability('gsp_resolve', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('gsp.write');
  });

  it('HARD-DENY: gsp_propose is denied (requires gsp.write)', () => {
    const r = checkToolCapability('gsp_propose', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('gsp.write');
  });

  it('HARD-DENY: policy_create is denied (requires policy.write)', () => {
    const r = checkToolCapability('policy_create', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('policy.write');
  });

  it('HARD-DENY: pulse_pause_program is denied (requires pulse.write)', () => {
    const r = checkToolCapability('pulse_pause_program', WINGMAN_CAPS);
    // pulse_pause_program maps to pulse.write which wingman lacks
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('pulse.write');
  });
});

describe('G-2 — tools/list topology hiding (a)', () => {
  const wingmanNames = new Set(wingmanView.map(t => t.name));

  it('adversarial diff: zero keys_* names in wingman tools/list', () => {
    const leaks = wingmanView.filter(t => t.name.startsWith('keys_'));
    expect(leaks).toHaveLength(0);
  });

  it('adversarial diff: zero admin_* names in wingman tools/list', () => {
    const leaks = wingmanView.filter(t => t.name.startsWith('admin_'));
    expect(leaks).toHaveLength(0);
  });

  it('adversarial diff: quarantine tools absent from wingman tools/list', () => {
    expect(wingmanNames.has('dispatch_quarantine_program')).toBe(false);
    expect(wingmanNames.has('dispatch_unquarantine_program')).toBe(false);
  });

  it('adversarial diff: policy_* tools absent from wingman tools/list', () => {
    const leaks = wingmanView.filter(t => t.name.startsWith('policy_'));
    expect(leaks).toHaveLength(0);
  });

  it('adversarial diff: all hard-deny tools are absent from wingman tools/list', () => {
    for (const toolName of HARD_DENY_TOOLS) {
      expect(wingmanNames.has(toolName)).toBe(false);
    }
  });

  it('wingman can see dispatch operational tools', () => {
    expect(wingmanNames.has('dispatch_get_tasks')).toBe(true);
    expect(wingmanNames.has('dispatch_create_task')).toBe(true);
    expect(wingmanNames.has('dispatch_claim_task')).toBe(true);
    expect(wingmanNames.has('dispatch_complete_task')).toBe(true);
    expect(wingmanNames.has('dispatch_dispatch')).toBe(true);
  });

  it('wingman can see relay + signal tools', () => {
    expect(wingmanNames.has('relay_send_message')).toBe(true);
    expect(wingmanNames.has('relay_get_messages')).toBe(true);
    expect(wingmanNames.has('signal_ask_question')).toBe(true);
    expect(wingmanNames.has('signal_send_alert')).toBe(true);
  });

  it('wingman can see result-read tools', () => {
    expect(wingmanNames.has('state_get_program_state')).toBe(true);
    expect(wingmanNames.has('state_recall_memory')).toBe(true);
    expect(wingmanNames.has('pulse_list_sessions')).toBe(true);
    expect(wingmanNames.has('programs_list_programs')).toBe(true);
  });
});

describe('G-2 — full/lite tiers unaffected (c)', () => {
  it('wildcard ["*"] sees all tools', () => {
    const result = filterToolsByCapabilities(ALL_TOOLS, ['*']);
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('full Grid programs (iso, basher) see all tools via wildcard', () => {
    for (const program of ['iso', 'basher', 'vector', 'sark']) {
      const caps = DEFAULT_CAPABILITIES[program];
      expect(caps).toContain('*');
      const result = filterToolsByCapabilities(ALL_TOOLS, caps);
      expect(result).toHaveLength(ALL_TOOLS.length);
    }
  });

  it('admin_merge_accounts still requires admin.write (not dispatch.write)', () => {
    expect(TOOL_CAPABILITIES['admin_merge_accounts']).toBe('admin.write');
  });

  it('quarantine tools require fleet.control (not dispatch.write)', () => {
    expect(TOOL_CAPABILITIES['dispatch_quarantine_program']).toBe('fleet.control');
    expect(TOOL_CAPABILITIES['dispatch_unquarantine_program']).toBe('fleet.control');
  });

  it('builder tier is unaffected — still has dispatch.write access', () => {
    const builderCaps = DEFAULT_CAPABILITIES['builder'];
    expect(checkToolCapability('dispatch_create_task', builderCaps).allowed).toBe(true);
    expect(checkToolCapability('relay_send_message', builderCaps).allowed).toBe(true);
  });

  it('filterToolsByCapabilities with wildcard is identity', () => {
    const result = filterToolsByCapabilities(ALL_TOOLS, ['*']);
    expect(result).toBe(ALL_TOOLS); // same reference, no copy
  });
});

describe('Coverage — all panel-flagged unmapped tools now have TOOL_CAPABILITIES entries', () => {
  // These are the tools the 3-voter security panel confirmed were missing from TOOL_CAPABILITIES.
  // Presence here proves the coverage gap is closed. The fail-closed change ensures any
  // future unmapped tool is denied automatically, making this list self-protecting.
  const PREVIOUSLY_UNMAPPED = [
    // CRITICAL — exfiltration surface (webhook callbackUrl)
    'webhook_register', 'webhook_list', 'webhook_delete', 'webhook_get_deliveries',
    // SECONDARY — metrics data wingman should not read
    'metrics_get_cost_forecast', 'metrics_get_sla_compliance', 'metrics_get_program_health',
    // ADDITIONAL — enrichment/analytics tier
    'clu_ingest', 'clu_analyze', 'clu_report',
    'schedule_create', 'schedule_list', 'schedule_get', 'schedule_update', 'schedule_delete',
    'pattern_consolidate', 'pattern_get_consolidated',
    // Lite-profile egress
    'request_help',
  ];

  it('every previously-unmapped tool now has a TOOL_CAPABILITIES entry', () => {
    const stillMissing = PREVIOUSLY_UNMAPPED.filter(name => !(name in TOOL_CAPABILITIES));
    expect(stillMissing).toHaveLength(0);
  });
});

describe('Fail-closed — unmapped tools are denied for restricted callers', () => {
  it('an unmapped tool is denied for a non-wildcard caller', () => {
    const r = checkToolCapability('__hypothetical_future_tool__', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('unmapped');
  });

  it('an unmapped tool is allowed for a wildcard caller', () => {
    const r = checkToolCapability('__hypothetical_future_tool__', ['*']);
    expect(r.allowed).toBe(true);
  });

  it('filterToolsByCapabilities hides unmapped tools from restricted callers', () => {
    const tools = [makeTool('__hypothetical_future_tool__')];
    expect(filterToolsByCapabilities(tools, WINGMAN_CAPS)).toHaveLength(0);
    expect(filterToolsByCapabilities(tools, ['*'])).toHaveLength(1);
  });
});

describe('Webhook security — wingman cannot register exfiltration endpoints', () => {
  it('HARD-DENY: webhook_register is denied at execution gate (requires webhooks.write)', () => {
    const r = checkToolCapability('webhook_register', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('webhooks.write');
  });

  it('HARD-DENY: webhook_delete is denied at execution gate', () => {
    const r = checkToolCapability('webhook_delete', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('webhooks.write');
  });

  it('HARD-DENY: webhook_list is denied at execution gate', () => {
    const r = checkToolCapability('webhook_list', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('webhooks.read');
  });

  it('HARD-DENY: webhook_get_deliveries is denied at execution gate', () => {
    const r = checkToolCapability('webhook_get_deliveries', WINGMAN_CAPS);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.required).toBe('webhooks.read');
  });

  it('G-2: zero webhook_* names appear in wingman tools/list', () => {
    const leaks = wingmanView.filter((t: ToolDef) => t.name.startsWith('webhook_'));
    expect(leaks).toHaveLength(0);
  });

  it('webhook_register uses webhooks.write (NOT relay.write — segregated from relay.*)', () => {
    expect(TOOL_CAPABILITIES['webhook_register']).toBe('webhooks.write');
    expect(TOOL_CAPABILITIES['webhook_register']).not.toBe('relay.write');
  });

  it('builder tier CAN access webhooks (not denied by fail-closed change)', () => {
    const builderCaps = DEFAULT_CAPABILITIES['builder'];
    expect(checkToolCapability('webhook_register', builderCaps).allowed).toBe(true);
    expect(checkToolCapability('webhook_list', builderCaps).allowed).toBe(true);
  });

  it('wingman has no webhooks.* capabilities', () => {
    expect(WINGMAN_CAPS).not.toContain('webhooks.read');
    expect(WINGMAN_CAPS).not.toContain('webhooks.write');
  });
});

describe('Metrics security — wingman cannot read cost/SLA/health data', () => {
  it('HARD-DENY: metrics_get_cost_forecast denied for wingman', () => {
    expect(checkToolCapability('metrics_get_cost_forecast', WINGMAN_CAPS).allowed).toBe(false);
  });

  it('HARD-DENY: metrics_get_sla_compliance denied for wingman', () => {
    expect(checkToolCapability('metrics_get_sla_compliance', WINGMAN_CAPS).allowed).toBe(false);
  });

  it('HARD-DENY: metrics_get_program_health denied for wingman', () => {
    expect(checkToolCapability('metrics_get_program_health', WINGMAN_CAPS).allowed).toBe(false);
  });

  it('G-2: zero metrics_get_cost_forecast/sla/health appear in wingman tools/list', () => {
    const leaks = wingmanView.filter((t: ToolDef) =>
      ['metrics_get_cost_forecast', 'metrics_get_sla_compliance', 'metrics_get_program_health'].includes(t.name)
    );
    expect(leaks).toHaveLength(0);
  });
});
