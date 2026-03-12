/**
 * Domain-Prefixed Tool Alias Tests
 */

// Mock modules that import @octokit/rest to avoid ESM import issues
jest.mock('../modules/github-sync', () => ({}));
jest.mock('../tools/feedback', () => ({
  handlers: {
    feedback_submit_feedback: async () => ({ content: [{ type: 'text', text: 'mocked' }] })
  },
  definitions: [
    { name: 'feedback_submit_feedback', description: 'Mocked feedback tool', inputSchema: { type: 'object', properties: {} } },
    { name: 'submit_feedback', description: 'Alias → feedback_submit_feedback', inputSchema: { type: 'object', properties: {} } }
  ]
}));

import { TOOL_ALIASES, resolveToolAlias, getToolAlias } from '../tools/tool-aliases';
import { TOOL_HANDLERS, TOOL_DEFINITIONS } from '../tools/index';

describe('Tool Aliases', () => {
  describe('resolveToolAlias', () => {
    it('resolves dispatch aliases to canonical names', () => {
      expect(resolveToolAlias('create_task')).toBe('dispatch_create_task');
      expect(resolveToolAlias('claim_task')).toBe('dispatch_claim_task');
      expect(resolveToolAlias('complete_task')).toBe('dispatch_complete_task');
      expect(resolveToolAlias('get_tasks')).toBe('dispatch_get_tasks');
      expect(resolveToolAlias('dispatch_batch_claim')).toBe('dispatch_batch_claim_tasks');
    });

    it('resolves relay aliases to canonical names', () => {
      expect(resolveToolAlias('relay_send')).toBe('relay_send_message');
      expect(resolveToolAlias('get_messages')).toBe('relay_get_messages');
      expect(resolveToolAlias('relay_get_sent')).toBe('relay_get_sent_messages');
      expect(resolveToolAlias('relay_query_history')).toBe('relay_query_message_history');
    });

    it('resolves session aliases to canonical names', () => {
      expect(resolveToolAlias('session_create')).toBe('pulse_create_session');
      expect(resolveToolAlias('session_update')).toBe('pulse_update_session');
      expect(resolveToolAlias('session_list')).toBe('pulse_list_sessions');
    });

    it('resolves state aliases to canonical names', () => {
      expect(resolveToolAlias('state_get')).toBe('state_get_program_state');
      expect(resolveToolAlias('state_update')).toBe('state_update_program_state');
      expect(resolveToolAlias('store_memory')).toBe('state_store_memory');
      expect(resolveToolAlias('recall_memory')).toBe('state_recall_memory');
    });

    it('resolves sprint aliases to canonical names', () => {
      expect(resolveToolAlias('sprint_create')).toBe('sprint_create_sprint');
      expect(resolveToolAlias('sprint_get')).toBe('sprint_get_sprint');
      expect(resolveToolAlias('sprint_complete')).toBe('sprint_complete_sprint');
    });

    it('passes through canonical names unchanged', () => {
      expect(resolveToolAlias('dispatch_create_task')).toBe('dispatch_create_task');
      expect(resolveToolAlias('relay_send_message')).toBe('relay_send_message');
      expect(resolveToolAlias('gsp_bootstrap')).toBe('gsp_bootstrap');
    });

    it('passes through unknown names unchanged', () => {
      expect(resolveToolAlias('nonexistent_tool')).toBe('nonexistent_tool');
    });
  });

  describe('getToolAlias', () => {
    it('returns alias for canonical names', () => {
      expect(getToolAlias('dispatch_create_task')).toBe('create_task');
      // Note: when multiple aliases exist, reverse map returns last one in iteration order
      expect(getToolAlias('relay_send_message')).toBe('relay_send');
      expect(getToolAlias('pulse_create_session')).toBe('session_create');
    });

    it('returns undefined for tools without aliases', () => {
      expect(getToolAlias('gsp_bootstrap')).toBeUndefined();
      expect(getToolAlias('clu_analyze')).toBeUndefined();
    });
  });

  describe('alias integrity', () => {
    it('every alias maps to an existing canonical handler', () => {
      for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
        expect(TOOL_HANDLERS[canonical]).toBeDefined();
      }
    });

    it('every canonical tool has a corresponding definition', () => {
      const definedNames = new Set(TOOL_DEFINITIONS.map((d: any) => d.name));
      const canonicalNames = new Set(Object.values(TOOL_ALIASES));
      // Internal/hidden tools (usage_*) may not have public definitions
      const internalTools = new Set(['usage_get_usage', 'usage_get_invoice', 'usage_set_budget']);
      const missing = [];
      for (const canonical of canonicalNames) {
        if (!definedNames.has(canonical) && !internalTools.has(canonical)) {
          missing.push(canonical);
        }
      }
      if (missing.length > 0) {
        console.log('Missing canonical tools:', missing.slice(0, 5));
      }
      expect(missing.length).toBe(0);
    });

    it('alias definitions reference canonical in description', () => {
      const aliasNames = new Set(Object.keys(TOOL_ALIASES));
      for (const def of TOOL_DEFINITIONS as any[]) {
        if (aliasNames.has(def.name)) {
          const canonical = TOOL_ALIASES[def.name];
          expect(def.description).toContain(`Alias → ${canonical}`);
        }
      }
    });

    it('no alias shadows an existing canonical tool name', () => {
      const canonicalNames = new Set(Object.values(TOOL_ALIASES));
      for (const alias of Object.keys(TOOL_ALIASES)) {
        // An alias should not also be a canonical tool name
        expect(canonicalNames.has(alias)).toBe(false);
      }
    });
  });
});
