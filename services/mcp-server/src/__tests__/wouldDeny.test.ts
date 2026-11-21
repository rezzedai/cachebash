import { hasCapability, checkToolCapability } from '../middleware/capabilities';
import { logWouldDeny } from '../auth/denialLog';

describe('authz_would_deny (RD-5 PR-N1)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());
  const lines = () => warn.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((l) => l.event === 'authz_would_deny');

  it('logs one line and still passes when only "*" satisfies the capability', () => {
    expect(hasCapability(['*'], 'dispatch.read', { principal: 'alpha', tool: 't', site: 's' })).toBe(true);
    expect(lines()).toEqual([{ severity: 'WARNING', event: 'authz_would_deny', principal: 'alpha', tool: 't', capability: 'dispatch.read', site: 's' }]);
  });

  it('logs nothing when the literal capability is held, or no context is given', () => {
    expect(hasCapability(['*', 'dispatch.read'], 'dispatch.read', { principal: 'alpha', tool: 't', site: 's' })).toBe(true);
    expect(hasCapability(['*'], 'dispatch.read')).toBe(true);
    expect(hasCapability(['relay.read'], 'dispatch.read', { principal: 'alpha', tool: 't', site: 's' })).toBe(false);
    expect(lines()).toEqual([]);
  });

  it('logs the unmapped-tool pass and keeps the decision', () => {
    expect(checkToolCapability('no_such_tool', ['*'], 'alpha')).toEqual({ allowed: true });
    expect(lines()).toMatchObject([{ principal: 'alpha', tool: 'no_such_tool', capability: 'unmapped' }]);
    expect(checkToolCapability('no_such_tool', ['relay.read'], 'alpha')).toMatchObject({ allowed: false });
    expect(lines()).toHaveLength(1);
  });

  it('never throws when the logger fails', () => {
    warn.mockImplementation(() => { throw new Error('sink down'); });
    expect(() => logWouldDeny({ principal: 'a', tool: 't', capability: 'c', site: 's' })).not.toThrow();
    expect(hasCapability(['*'], 'dispatch.read', { principal: 'alpha', tool: 't', site: 's' })).toBe(true);
  });
});
