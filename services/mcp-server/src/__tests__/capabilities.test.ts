/**
 * Capability-Based Access Control Tests
 */

import { hasCapability, checkToolCapability, getDefaultCapabilities, TOOL_CAPABILITIES, DEFAULT_CAPABILITIES } from '../middleware/capabilities';

describe('Capability System', () => {
  describe('hasCapability', () => {
    it('wildcard grants all access', () => {
      expect(hasCapability(['*'], 'dispatch.read')).toBe(true);
      expect(hasCapability(['*'], 'keys.write')).toBe(true);
      expect(hasCapability(['*'], 'audit.read')).toBe(true);
    });

    it('exact match grants access', () => {
      expect(hasCapability(['dispatch.read', 'relay.write'], 'dispatch.read')).toBe(true);
      expect(hasCapability(['dispatch.read', 'relay.write'], 'relay.write')).toBe(true);
    });

    it('missing capability denies access', () => {
      expect(hasCapability(['dispatch.read'], 'keys.write')).toBe(false);
      expect(hasCapability(['relay.read'], 'relay.write')).toBe(false);
    });

    it('empty capabilities deny everything', () => {
      expect(hasCapability([], 'dispatch.read')).toBe(false);
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

    it('allows unknown tools (fail-open)', () => {
      const result = checkToolCapability('nonexistent_tool', ['dispatch.read']);
      expect(result.allowed).toBe(true);
    });

    it('wildcard allows all tools', () => {
      expect(checkToolCapability('get_tasks', ['*']).allowed).toBe(true);
      expect(checkToolCapability('create_key', ['*']).allowed).toBe(true);
      expect(checkToolCapability('get_audit', ['*']).allowed).toBe(true);
    });
  });

  describe('TOOL_CAPABILITIES coverage', () => {
    it('every tool in the map has a valid capability', () => {
      const validPrefixes = [
        'dispatch', 'relay', 'pulse', 'signal', 'dream',
        'sprint', 'keys', 'audit', 'state', 'metrics', 'fleet', 'trace', 'programs', 'gsp'
      ];
      for (const [tool, cap] of Object.entries(TOOL_CAPABILITIES)) {
        if (cap === '*') continue;
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
    it('orchestrator has wildcard', () => {
      expect(DEFAULT_CAPABILITIES['orchestrator']).toEqual(['*']);
    });

    it('legacy has wildcard', () => {
      expect(DEFAULT_CAPABILITIES['legacy']).toEqual(['*']);
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
  });

  describe('getDefaultCapabilities', () => {
    it('returns defaults for known programs', () => {
      expect(getDefaultCapabilities('orchestrator')).toEqual(['*']);
      expect(getDefaultCapabilities('builder')).toContain('dispatch.read');
    });

    it('returns default capabilities for unknown programs', () => {
      expect(getDefaultCapabilities('unknown_program')).toEqual(
        DEFAULT_CAPABILITIES['default']
      );
    });
  });
});
