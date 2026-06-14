/**
 * Unit tests for firebaseAuthValidator.ts
 * Covers the PORTAL_PRINCIPALS UID-gating security fix.
 */

import { validateFirebaseToken } from '../auth/firebaseAuthValidator';

const FLYNN_UID = '7viFKVtl5lgzguhFoZlnYYrqeDG2';

const mockVerifyIdToken = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

jest.mock('../middleware/capabilities', () => ({
  getDefaultCapabilities: (role: string) => [`${role}.read`],
}));

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    uid: FLYNN_UID,
    email: 'christian@rezzed.ai',
    email_verified: true,
    ...overrides,
  };
}

describe('validateFirebaseToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('elevates to flynn when email + UID + email_verified all match', async () => {
    mockVerifyIdToken.mockResolvedValue(makeToken());
    const ctx = await validateFirebaseToken('eyJ.fake.token');
    expect(ctx?.programId).toBe('flynn');
    expect(ctx?.userId).toBe(FLYNN_UID);
  });

  it('falls through to mobile when email matches but UID is different', async () => {
    mockVerifyIdToken.mockResolvedValue(makeToken({ uid: 'attacker-uid-not-flynn' }));
    const ctx = await validateFirebaseToken('eyJ.fake.token');
    expect(ctx?.programId).toBe('mobile');
  });

  it('falls through to mobile when email matches but email_verified is false', async () => {
    mockVerifyIdToken.mockResolvedValue(makeToken({ email_verified: false }));
    const ctx = await validateFirebaseToken('eyJ.fake.token');
    expect(ctx?.programId).toBe('mobile');
  });

  it('falls through to mobile for an unknown email', async () => {
    mockVerifyIdToken.mockResolvedValue(makeToken({ email: 'unknown@example.com', uid: 'some-uid' }));
    const ctx = await validateFirebaseToken('eyJ.fake.token');
    expect(ctx?.programId).toBe('mobile');
  });

  it('returns null when verifyIdToken throws', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('token expired'));
    const ctx = await validateFirebaseToken('eyJ.fake.token');
    expect(ctx).toBeNull();
  });
});
