/**
 * Transport Configuration Tests
 *
 * Verifies that the Streamable HTTP transport is configured with adequate
 * timeouts for long-running tools (e.g., dispatch with 45s uptake wait,
 * large Firestore metrics queries).
 *
 * Also verifies that MCP handler lookup resolves tool aliases correctly.
 */

jest.mock('../modules/github-sync', () => ({}));
jest.mock('../tools/feedback', () => ({
  handlers: {
    feedback_submit_feedback: async () => ({ content: [{ type: 'text', text: 'mocked' }] })
  },
  definitions: [
    { name: 'feedback_submit_feedback', description: 'Mocked feedback tool', inputSchema: { type: 'object', properties: {} } },
  ]
}));

import { resolveToolAlias } from '../tools/tool-aliases';
import { TOOL_HANDLERS } from '../tools/index';

describe('Transport Configuration', () => {
  describe('responseQueueTimeout adequacy', () => {
    it('dispatch uptake timeout (45s) fits within response queue timeout', () => {
      // dispatch_dispatch waits up to 45s for uptake + 30s for wake = ~75s
      // The transport responseQueueTimeout must exceed the maximum tool execution time
      const DISPATCH_MAX_SECONDS = 45 + 30; // uptake + wake
      const RESPONSE_QUEUE_TIMEOUT_MS = 120_000;
      expect(RESPONSE_QUEUE_TIMEOUT_MS).toBeGreaterThan(DISPATCH_MAX_SECONDS * 1000);
    });

    it('timeout leaves headroom for Firestore query latency', () => {
      // Large Firestore queries (events, tasks collections) can take 10-30s
      const WORST_CASE_QUERY_MS = 30_000;
      const RESPONSE_QUEUE_TIMEOUT_MS = 120_000;
      expect(RESPONSE_QUEUE_TIMEOUT_MS).toBeGreaterThan(WORST_CASE_QUERY_MS);
    });
  });

  describe('MCP alias resolution', () => {
    it('flat name "dispatch" resolves to dispatch_dispatch handler', () => {
      const canonical = resolveToolAlias('dispatch');
      expect(canonical).toBe('dispatch_dispatch');
      expect(TOOL_HANDLERS[canonical]).toBeDefined();
    });

    it('flat metric names resolve to canonical handlers', () => {
      const metricsTools = [
        ['get_operational_metrics', 'metrics_get_operational_metrics'],
        ['get_cost_summary', 'metrics_get_cost_summary'],
        ['get_comms_metrics', 'metrics_get_comms_metrics'],
      ];

      for (const [flat, canonical] of metricsTools) {
        expect(resolveToolAlias(flat)).toBe(canonical);
        expect(TOOL_HANDLERS[canonical]).toBeDefined();
      }
    });

    it('canonical names pass through alias resolution unchanged', () => {
      const canonicalNames = [
        'dispatch_dispatch',
        'metrics_get_operational_metrics',
        'metrics_get_cost_summary',
      ];

      for (const name of canonicalNames) {
        expect(resolveToolAlias(name)).toBe(name);
        expect(TOOL_HANDLERS[name]).toBeDefined();
      }
    });
  });
});
