/**
 * Domain-Prefixed Tool Alias Tests
 */

import { TOOL_ALIASES, resolveToolAlias, getToolAlias } from '../tools/tool-aliases';
import { TOOL_HANDLERS, TOOL_DEFINITIONS } from '../tools/index';

describe('Tool Aliases', () => {
  describe('resolveToolAlias', () => {
    it('resolves dispatch aliases to canonical names', () => {
      expect(resolveToolAlias('dispatch_create_task')).toBe('create_task');
      expect(resolveToolAlias('dispatch_claim_task')).toBe('claim_task');
      expect(resolveToolAlias('dispatch_complete_task')).toBe('complete_task');
      expect(resolveToolAlias('dispatch_get_tasks')).toBe('get_tasks');
      expect(resolveToolAlias('dispatch_batch_claim')).toBe('batch_claim_tasks');
    });

    it('resolves relay aliases to canonical names', () => {
      expect(resolveToolAlias('relay_send')).toBe('send_message');
      expect(resolveToolAlias('relay_get_messages')).toBe('get_messages');
      expect(resolveToolAlias('relay_get_sent')).toBe('get_sent_messages');
      expect(resolveToolAlias('relay_query_history')).toBe('query_message_history');
    });

    it('resolves session aliases to canonical names', () => {
      expect(resolveToolAlias('session_create')).toBe('create_session');
      expect(resolveToolAlias('session_update')).toBe('update_session');
      expect(resolveToolAlias('session_list')).toBe('list_sessions');
    });

    it('resolves state aliases to canonical names', () => {
      expect(resolveToolAlias('state_get')).toBe('get_program_state');
      expect(resolveToolAlias('state_update')).toBe('update_program_state');
      expect(resolveToolAlias('state_store_memory')).toBe('store_memory');
      expect(resolveToolAlias('state_recall_memory')).toBe('recall_memory');
    });

    it('resolves sprint aliases to canonical names', () => {
      expect(resolveToolAlias('sprint_create')).toBe('create_sprint');
      expect(resolveToolAlias('sprint_get')).toBe('get_sprint');
      expect(resolveToolAlias('sprint_complete')).toBe('complete_sprint');
    });

    it('passes through canonical names unchanged', () => {
      expect(resolveToolAlias('create_task')).toBe('create_task');
      expect(resolveToolAlias('send_message')).toBe('send_message');
      expect(resolveToolAlias('gsp_bootstrap')).toBe('gsp_bootstrap');
    });

    it('passes through unknown names unchanged', () => {
      expect(resolveToolAlias('nonexistent_tool')).toBe('nonexistent_tool');
    });
  });

  describe('getToolAlias', () => {
    it('returns alias for canonical names', () => {
      expect(getToolAlias('create_task')).toBe('dispatch_create_task');
      expect(getToolAlias('send_message')).toBe('relay_send');
      expect(getToolAlias('create_session')).toBe('session_create');
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

    it('every alias has a corresponding tool definition', () => {
      const definedNames = new Set(TOOL_DEFINITIONS.map((d: any) => d.name));
      for (const alias of Object.keys(TOOL_ALIASES)) {
        expect(definedNames.has(alias)).toBe(true);
      }
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
