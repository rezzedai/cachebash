/**
 * Auth Phase 0: Dual-mode auth middleware tests
 * Tests X-Program-Id header override with AUTH_MODE support
 */

import { validateApiKey, validateAuth } from '../auth/authValidator';
import { getFirestore } from '../firebase/client';
import * as crypto from 'crypto';

// Mock modules
jest.mock('../firebase/client');
jest.mock('../middleware/capabilities');
jest.mock('../auth/tenant-resolver', () => ({
  resolveTenant: jest.fn().mockResolvedValue({ canonical: true, tenantId: 'test-user-id' }),
}));

const mockGetFirestore = getFirestore as jest.MockedFunction<typeof getFirestore>;
const mockGetDefaultCapabilities = jest.fn();

// Mock capabilities module
jest.mock('../middleware/capabilities', () => ({
  getDefaultCapabilities: (roleOrProgramId: string) => {
    return mockGetDefaultCapabilities(roleOrProgramId);
  },
}));

describe('Auth Phase 0: Dual-mode auth middleware', () => {
  const testApiKey = 'cb_test_key_123456789';
  const testUserId = 'test-user-id';
  const keyHash = crypto.createHash('sha256').update(testApiKey).digest('hex');

  let mockDb: any;
  let originalAuthMode: string | undefined;

  beforeEach(() => {
    // Save original AUTH_MODE
    originalAuthMode = process.env.AUTH_MODE;
    
    // Reset mocks
    jest.clearAllMocks();
    mockGetDefaultCapabilities.mockReturnValue(['dispatch.read', 'relay.write']);

    // Mock Firestore
    mockDb = {
      doc: jest.fn(),
    };
    mockGetFirestore.mockReturnValue(mockDb as any);
  });

  afterEach(() => {
    // Restore original AUTH_MODE
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
  });

  describe('hybrid mode (default)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'hybrid';
    });

    it('uses header programId when X-Program-Id is present and program exists', async () => {
      // Mock key doc
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'legacy',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      // Mock program doc
      const programDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            active: true,
            role: 'worker',
          }),
        }),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        if (path === `tenants/${testUserId}/programs/iso`) return programDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey, 'iso');

      expect(result).not.toBeNull();
      expect(result?.programId).toBe('iso');
      expect(result?.userId).toBe(testUserId);
      expect(programDocRef.get).toHaveBeenCalled();
      expect(mockGetDefaultCapabilities).toHaveBeenCalledWith('worker');
    });

    it('falls back to key programId when X-Program-Id is not present', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'vector',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey);

      expect(result).not.toBeNull();
      expect(result?.programId).toBe('vector');
      expect(mockGetDefaultCapabilities).toHaveBeenCalledWith('vector');
    });

    it('rejects when X-Program-Id program does not exist', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'legacy',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      const programDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: false,
        }),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        if (path === `tenants/${testUserId}/programs/nonexistent`) return programDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey, 'nonexistent');

      expect(result).toBeNull();
    });

    it('rejects when X-Program-Id program is inactive', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'legacy',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      const programDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            active: false,
            role: 'worker',
          }),
        }),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        if (path === `tenants/${testUserId}/programs/inactive`) return programDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey, 'inactive');

      expect(result).toBeNull();
    });
  });

  describe('key_identity mode', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'key_identity';
    });

    it('ignores X-Program-Id header and uses key programId', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'vector',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      // Pass programIdOverride but it should be ignored
      const result = await validateApiKey(testApiKey, 'iso');

      expect(result).not.toBeNull();
      expect(result?.programId).toBe('vector');
      expect(mockGetDefaultCapabilities).toHaveBeenCalledWith('vector');
      // Program doc should NOT be fetched
      expect(mockDb.doc).toHaveBeenCalledTimes(2); // keyIndex doc + update
    });
  });

  describe('gsp_identity mode', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'gsp_identity';
    });

    it('rejects cb_ key without X-Program-Id header', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'vector',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey);

      expect(result).toBeNull();
    });

    it('accepts cb_ key with valid X-Program-Id header', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'legacy',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      const programDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            active: true,
            role: 'orchestrator',
          }),
        }),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        if (path === `tenants/${testUserId}/programs/vector`) return programDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      const result = await validateApiKey(testApiKey, 'vector');

      expect(result).not.toBeNull();
      expect(result?.programId).toBe('vector');
      expect(mockGetDefaultCapabilities).toHaveBeenCalledWith('orchestrator');
    });
  });

  describe('validateAuth wrapper', () => {
    it('passes programIdOverride to validateApiKey for cb_ keys', async () => {
      const keyDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: testUserId,
            programId: 'legacy',
            active: true,
            rateLimitTier: 'free',
          }),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };

      const programDocRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            active: true,
            role: 'worker',
          }),
        }),
      };

      mockDb.doc.mockImplementation((path: string) => {
        if (path === `keyIndex/${keyHash}`) return keyDocRef;
        if (path === `tenants/${testUserId}/programs/iso`) return programDocRef;
        throw new Error(`Unexpected doc path: ${path}`);
      });

      process.env.AUTH_MODE = 'hybrid';
      const result = await validateAuth(testApiKey, 'iso');

      expect(result).not.toBeNull();
      expect(result?.programId).toBe('iso');
    });
  });
});
