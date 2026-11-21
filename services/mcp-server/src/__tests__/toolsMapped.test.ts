jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
import { TOOL_DEFINITIONS } from '../tools/index';
import { TOOL_CAPABILITIES } from '../middleware/capabilities';

/** RD-5 PR-N N-D2: an unmapped tool is denied for every key, so every defined tool needs a capability. */
describe('every defined tool is mapped to a capability', () => {
  it('has no tool in tools/*.ts without a TOOL_CAPABILITIES entry', () => {
    const names = TOOL_DEFINITIONS.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n: string) => !(n in TOOL_CAPABILITIES))).toEqual([]);
  });

  it('maps the two tools that passed only through the wildcard branch to dispatch.write', () => {
    expect(TOOL_CAPABILITIES['dispatch_backfill_task_expires_at']).toBe('dispatch.write');
    expect(TOOL_CAPABILITIES['dispatch_reap_expired_tasks']).toBe('dispatch.write');
  });
});
