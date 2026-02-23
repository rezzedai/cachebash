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
        'sprint', 'keys', 'audit', 'state', 'metrics', 'fleet', 'trace'
      ];
      for (const [tool, cap] of Object.entries(TOOL_CAPABILITIES)) {
        if (cap === '*') continue;
        const [prefix] = cap.split('.');
        expect(validPrefixes).toContain(prefix);
      }
    });

    it('maps all 25 known tools', () => {
      const knownTools = [
        'get_tasks', 'create_task', 'claim_task', 'complete_task',
        'send_message', 'get_messages', 'get_dead_letters', 'list_groups',
        'get_sent_messages', 'query_message_history',
        'create_session', 'update_session', 'list_sessions',
        'ask_question', 'get_response', 'send_alert',
        'dream_peek', 'dream_activate',
        'create_sprint', 'update_sprint_story', 'add_story_to_sprint',
        'complete_sprint', 'get_sprint',
        'create_key', 'revoke_key', 'list_keys',
        'get_audit',
        'get_program_state', 'update_program_state',
        'get_cost_summary', 'get_comms_metrics', 'get_operational_metrics',
        'get_fleet_health',
        'query_traces',
      ];
      for (const tool of knownTools) {
        expect(TOOL_CAPABILITIES[tool]).toBeDefined();
      }
    });
  });

  describe('DEFAULT_CAPABILITIES', () => {
    it('orchestrator has wildcard', () => {
      expect(DEFAULT_CAPABILITIES['iso']).toEqual(['*']);
    });

    it('legacy has wildcard', () => {
      expect(DEFAULT_CAPABILITIES['legacy']).toEqual(['*']);
    });

    it('builder programs can read and write dispatch', () => {
      const builders = ['basher', 'alan', 'sark', 'quorra', 'radia', 'able', 'beck', 'ram', 'vector'];
      for (const prog of builders) {
        expect(DEFAULT_CAPABILITIES[prog]).toContain('dispatch.read');
        expect(DEFAULT_CAPABILITIES[prog]).toContain('dispatch.write');
      }
    });

    it('builder programs cannot manage keys', () => {
      const builders = ['basher', 'alan', 'quorra', 'radia', 'able', 'beck', 'ram', 'vector'];
      for (const prog of builders) {
        expect(DEFAULT_CAPABILITIES[prog]).not.toContain('keys.write');
      }
    });

    it('mobile has fleet.read and metrics.read', () => {
      expect(DEFAULT_CAPABILITIES['mobile']).toContain('fleet.read');
      expect(DEFAULT_CAPABILITIES['mobile']).toContain('metrics.read');
    });

    it('auditor has audit.read (security role)', () => {
      expect(DEFAULT_CAPABILITIES['sark']).toContain('audit.read');
    });
  });

  describe('getDefaultCapabilities', () => {
    it('returns defaults for known programs', () => {
      expect(getDefaultCapabilities('iso')).toEqual(['*']);
      expect(getDefaultCapabilities('basher')).toContain('dispatch.read');
    });

    it('returns wildcard for unknown programs (fail-open)', () => {
      expect(getDefaultCapabilities('unknown_program')).toEqual(['*']);
    });
  });
});
