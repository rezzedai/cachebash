/**
 * Capability-Based Access Control Tests
 */

import { holdsCapability, WILDCARD_EQUIVALENT, checkToolCapability, getDefaultCapabilities, TOOL_CAPABILITIES, DEFAULT_CAPABILITIES } from '../middleware/capabilities';

describe('Capability System', () => {
  describe('holdsCapability', () => {
    it('wildcard grants nothing (RD-5 PR-N)', () => {
      expect(holdsCapability(['*'], 'dispatch.read')).toBe(false);
      expect(holdsCapability(['*'], 'keys.write')).toBe(false);
      expect(holdsCapability(['*'], 'audit.read')).toBe(false);
    });

    it('exact match grants access', () => {
      expect(holdsCapability(['dispatch.read', 'relay.write'], 'dispatch.read')).toBe(true);
      expect(holdsCapability(['dispatch.read', 'relay.write'], 'relay.write')).toBe(true);
    });

    it('missing capability denies access', () => {
      expect(holdsCapability(['dispatch.read'], 'keys.write')).toBe(false);
      expect(holdsCapability(['relay.read'], 'relay.write')).toBe(false);
    });

    it('empty capabilities deny everything', () => {
      expect(holdsCapability([], 'dispatch.read')).toBe(false);
    });
  });

  describe('checkToolCapability', () => {
    it('allows tool when capability present', () => {
      const result = checkToolCapability('get_tasks', ['dispatch.read']);
      expect(result.allowed).toBe(true);
    });

    it('denies tool when capability missing', () => {
      const result = checkToolCapability('create_key', ['dispatch.read']);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.required).toBe('keys.write');
        expect(result.held).toEqual(['dispatch.read']);
      }
    });

    it('denies unknown tools for restricted callers (fail-closed)', () => {
      const result = checkToolCapability('nonexistent_tool', ['dispatch.read']);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.required).toBe('unmapped');
    });

    it('denies unknown tools for wildcard callers (RD-5 PR-N N-D2)', () => {
      expect(checkToolCapability('nonexistent_tool', ['*']).allowed).toBe(false);
    });

    it('wildcard allows no tool (RD-5 PR-N N-D1)', () => {
      expect(checkToolCapability('get_tasks', ['*']).allowed).toBe(false);
      expect(checkToolCapability('create_key', ['*']).allowed).toBe(false);
      expect(checkToolCapability('get_audit', ['*']).allowed).toBe(false);
    });
  });

  describe('SARK-ruling: feedback_submit_feedback capability gating', () => {
    it('relay.write (without dispatch.write) permits feedback submission', () => {
      const result = checkToolCapability('feedback_submit_feedback', ['relay.write']);
      expect(result.allowed).toBe(true);
    });

    it('dispatch.write alone no longer permits feedback submission', () => {
      const result = checkToolCapability('feedback_submit_feedback', ['dispatch.write']);
      expect(result.allowed).toBe(false);
    });

    it('key with neither relay.write nor dispatch.write is denied', () => {
      const result = checkToolCapability('feedback_submit_feedback', ['dispatch.read', 'relay.read']);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.required).toBe('relay.write');
      }
    });

    it('feedback_submit_feedback maps to relay.write in TOOL_CAPABILITIES', () => {
      expect(TOOL_CAPABILITIES['feedback_submit_feedback']).toBe('relay.write');
    });
  });

  describe('TOOL_CAPABILITIES coverage', () => {
    it('ADR-013: relay read tools stay mapped to relay.read (no new capability)', () => {
      expect(TOOL_CAPABILITIES['relay_query_message_history']).toBe('relay.read');
      expect(TOOL_CAPABILITIES['relay_get_messages']).toBe('relay.read');
      expect(TOOL_CAPABILITIES['relay_get_sent_messages']).toBe('relay.read');
    });

    it('every tool in the map has a valid capability', () => {
      const validPrefixes = [
        'dispatch', 'relay', 'pulse', 'signal', 'dream',
        'sprint', 'keys', 'audit', 'state', 'metrics', 'fleet', 'trace', 'programs', 'gsp',
        'admin', 'policy', 'webhooks',
      ];
      for (const [tool, cap] of Object.entries(TOOL_CAPABILITIES)) {
        const [prefix] = cap.split('.');
        expect(validPrefixes).toContain(prefix);
      }
    });

    it('maps all 25 known tools', () => {
      const knownTools = [
        'dispatch_get_tasks', 'dispatch_create_task', 'dispatch_claim_task', 'dispatch_complete_task',
        'relay_send_message', 'relay_get_messages', 'relay_get_dead_letters', 'relay_list_groups',
        'relay_get_sent_messages', 'relay_query_message_history',
        'pulse_create_session', 'pulse_update_session', 'pulse_list_sessions',
        'signal_ask_question', 'signal_get_response', 'signal_send_alert',
        'dream_peek', 'dream_activate',
        'sprint_create_sprint', 'sprint_update_sprint_story', 'sprint_add_story_to_sprint',
        'sprint_complete_sprint', 'sprint_get_sprint',
        'keys_create_key', 'keys_revoke_key', 'keys_list_keys',
        'audit_get_audit',
        'state_get_program_state', 'state_update_program_state',
        'metrics_get_cost_summary', 'metrics_get_comms_metrics', 'metrics_get_operational_metrics',
        'pulse_get_fleet_health',
        'trace_query_traces',
      ];
      for (const tool of knownTools) {
        expect(TOOL_CAPABILITIES[tool]).toBeDefined();
      }
    });
  });

  describe('DEFAULT_CAPABILITIES', () => {
    it('orchestrator, admin and legacy hold WILDCARD_EQUIVALENT, named (RD-5 PR-N N-D3)', () => {
      for (const role of ['orchestrator', 'admin', 'legacy']) expect(DEFAULT_CAPABILITIES[role]).toEqual(WILDCARD_EQUIVALENT);
      expect(WILDCARD_EQUIVALENT).toHaveLength(30);
    });

    it('the named programs hold their table B sets (plan 22.1 item 6)', () => {
      expect(DEFAULT_CAPABILITIES['dispatcher']).toHaveLength(8);
      expect(DEFAULT_CAPABILITIES['iso']).toHaveLength(23);
      expect(DEFAULT_CAPABILITIES['vector']).toHaveLength(16);
      expect(DEFAULT_CAPABILITIES['vector']).not.toContain('keys.write');
      expect(DEFAULT_CAPABILITIES['basher']).toHaveLength(13);
      for (const p of ['alan', 'casp', 'quorra', 'radia']) expect(DEFAULT_CAPABILITIES[p]).toEqual(DEFAULT_CAPABILITIES['architect']);
      expect(DEFAULT_CAPABILITIES['sark']).toEqual([...DEFAULT_CAPABILITIES['architect'], 'keys.write']);
    });

    it("iso's set covers every builder default, so iso can mint a builder key (plan 22.1 item 1)", () => {
      for (const c of DEFAULT_CAPABILITIES['builder']) expect(DEFAULT_CAPABILITIES['iso']).toContain(c);
    });

    it('builder programs can read and write dispatch', () => {
      const builders = ['builder', 'architect', 'auditor', 'reviewer', 'designer', 'growth', 'ops', 'memory', 'strategist'];
      for (const prog of builders) {
        expect(DEFAULT_CAPABILITIES[prog]).toContain('dispatch.read');
        expect(DEFAULT_CAPABILITIES[prog]).toContain('dispatch.write');
      }
    });

    it('builder programs cannot manage keys', () => {
      const builders = ['builder', 'architect', 'reviewer', 'designer', 'growth', 'ops', 'memory', 'strategist'];
      for (const prog of builders) {
        expect(DEFAULT_CAPABILITIES[prog]).not.toContain('keys.write');
      }
    });

    it('mobile has fleet.read and metrics.read', () => {
      expect(DEFAULT_CAPABILITIES['mobile']).toContain('fleet.read');
      expect(DEFAULT_CAPABILITIES['mobile']).toContain('metrics.read');
    });

    it('auditor has audit.read (security role)', () => {
      expect(DEFAULT_CAPABILITIES['auditor']).toContain('audit.read');
    });

    it('C-1: oauth fallback carries zero .write capabilities', () => {
      const oauthCaps = DEFAULT_CAPABILITIES['oauth'];
      expect(oauthCaps).toBeDefined();
      const writeCaps = oauthCaps.filter(c => c.endsWith('.write'));
      expect(writeCaps).toHaveLength(0);
      expect(oauthCaps).toContain('dispatch.read');
      expect(oauthCaps).toContain('relay.read');
      expect(oauthCaps).not.toContain('dispatch.write');
      expect(oauthCaps).not.toContain('state.write');
      expect(oauthCaps).not.toContain('gsp.write');
    });
  });

  describe('getDefaultCapabilities', () => {
    it('returns defaults for known programs', () => {
      expect(getDefaultCapabilities('orchestrator')).toEqual(WILDCARD_EQUIVALENT);
      expect(getDefaultCapabilities('builder')).toContain('dispatch.read');
    });

    it('returns default capabilities for unknown programs', () => {
      expect(getDefaultCapabilities('unknown_program')).toEqual(
        DEFAULT_CAPABILITIES['default']
      );
    });
  });
});
