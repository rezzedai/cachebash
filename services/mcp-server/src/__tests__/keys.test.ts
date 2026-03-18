/**
 * Keys Module Unit Tests — H1
 *
 * Tests API key management: create, revoke, rotate, and list handlers.
 */

import type { AuthContext } from "../auth/authValidator";
import {
  createKeyHandler,
  revokeKeyHandler,
  rotateKeyHandler,
  listKeysHandler,
} from "../modules/keys";

// Mock data stores
const mockKeyDocs: Record<string, any> = {};

// Mock dependencies
jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../modules/programRegistry", () => ({
  isProgramRegistered: jest.fn(() => Promise.resolve(true)),
  registerProgram: jest.fn(() => Promise.resolve()),
}));

jest.mock("../middleware/capabilities", () => ({
  getDefaultCapabilities: jest.fn(() => ["*"]),
}));

// Mock Firestore
const mockDb = {
  doc: jest.fn((path: string) => {
    // Return a reference object that can be used both outside and inside transactions
    return {
      _path: path,
      get: jest.fn(async () => {
        const keyHash = path.split("/").pop()!;
        const data = mockKeyDocs[keyHash];
        return {
          exists: !!data,
          data: () => data,
          id: keyHash,
        };
      }),
      set: jest.fn(async (data: any) => {
        const keyHash = path.split("/").pop()!;
        mockKeyDocs[keyHash] = {
          ...data,
          createdAt: data.createdAt || { toDate: () => new Date() },
        };
      }),
      update: jest.fn(async (data: any) => {
        const keyHash = path.split("/").pop()!;
        mockKeyDocs[keyHash] = {
          ...mockKeyDocs[keyHash],
          ...data,
          revokedAt: data.revokedAt || mockKeyDocs[keyHash]?.revokedAt,
        };
      }),
    };
  }),
  collection: jest.fn((path: string) => ({
    where: jest.fn((field: string, op: string, value: any) => ({
      get: jest.fn(async () => {
        const docs = Object.entries(mockKeyDocs)
          .filter(([_, data]) => data[field] === value)
          .map(([keyHash, data]) => ({
            id: keyHash,
            data: () => data,
          }));
        return { docs, empty: docs.length === 0 };
      }),
    })),
  })),
  runTransaction: jest.fn(async (callback: any) => {
    const tx = {
      get: async (ref: any) => {
        const path = ref._path || "";
        const keyHash = path.split("/").pop();
        const data = mockKeyDocs[keyHash];
        return {
          exists: !!data,
          data: () => data,
        };
      },
      set: (ref: any, data: any) => {
        const path = ref._path || "";
        const keyHash = path.split("/").pop();
        mockKeyDocs[keyHash] = {
          ...data,
          createdAt: { toDate: () => new Date() },
        };
      },
      update: (ref: any, data: any) => {
        const path = ref._path || "";
        const keyHash = path.split("/").pop();
        mockKeyDocs[keyHash] = {
          ...mockKeyDocs[keyHash],
          ...data,
        };
      },
    };

    await callback(tx);
  }),
};

// Mock auth context
const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "existing-key-hash-abc",
  programId: "orchestrator",
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

describe("Keys Module Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockKeyDocs).forEach((key) => delete mockKeyDocs[key]);
  });

  describe("createKeyHandler", () => {
    it("creates key with SHA-256 hash and returns raw key", async () => {
      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Test Key",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.key).toMatch(/^cb_[0-9a-f]{64}$/);
      expect(data.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.label).toBe("Test Key");
      expect(data.message).toContain("Store this key securely");

      // Verify key was stored in mockKeyDocs
      expect(mockKeyDocs[data.keyHash]).toBeDefined();
      expect(mockKeyDocs[data.keyHash].userId).toBe("test-user-123");
      expect(mockKeyDocs[data.keyHash].programId).toBe("basher");
      expect(mockKeyDocs[data.keyHash].label).toBe("Test Key");
      expect(mockKeyDocs[data.keyHash].active).toBe(true);
    });

    it("auto-registers unknown program", async () => {
      const { isProgramRegistered, registerProgram } = require("../modules/programRegistry");
      (isProgramRegistered as jest.Mock).mockResolvedValueOnce(false);

      const result = await createKeyHandler(mockAuth, {
        programId: "new-program",
        label: "New",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.registered).toBe(true);
      expect(registerProgram).toHaveBeenCalledWith("test-user-123", {
        programId: "new-program",
        displayName: "new-program",
        role: "custom",
        color: "#808080",
        groups: [],
        tags: [],
        createdBy: "orchestrator",
      });
    });

    it("returns default capabilities when none specified", async () => {
      const { getDefaultCapabilities } = require("../middleware/capabilities");
      (getDefaultCapabilities as jest.Mock).mockReturnValueOnce(["dispatch.read", "dispatch.write"]);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Default Caps",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.capabilities).toEqual(["dispatch.read", "dispatch.write"]);
    });

    it("uses provided capabilities when specified", async () => {
      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Scoped",
        capabilities: ["dispatch.read"],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.capabilities).toEqual(["dispatch.read"]);
    });

    it("falls back to ['*'] when no defaults and no capabilities provided", async () => {
      const { getDefaultCapabilities } = require("../middleware/capabilities");
      (getDefaultCapabilities as jest.Mock).mockReturnValueOnce([]);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Fallback",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.capabilities).toEqual(["*"]);
    });

    it("rejects missing programId", async () => {
      const result = await createKeyHandler(mockAuth, {
        label: "Missing",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("programId is required");
    });

    it("rejects missing label", async () => {
      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("label is required");
    });
  });

  describe("revokeKeyHandler", () => {
    it("soft revokes an existing key", async () => {
      // Seed a key
      mockKeyDocs["abc123"] = {
        userId: "test-user-123",
        programId: "basher",
        label: "Test Key",
        active: true,
        createdAt: { toDate: () => new Date() },
      };

      const result = await revokeKeyHandler(mockAuth, { keyHash: "abc123" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.keyHash).toBe("abc123");
      expect(data.message).toContain("Key revoked");

      // Verify update was called
      expect(mockKeyDocs["abc123"].active).toBe(false);
      expect(mockKeyDocs["abc123"].revokedAt).toBeDefined();
    });

    it("rejects revocation of another user's key", async () => {
      // Seed a key for different user
      mockKeyDocs["def456"] = {
        userId: "different-user",
        programId: "basher",
        label: "Other Key",
        active: true,
        createdAt: { toDate: () => new Date() },
      };

      const result = await revokeKeyHandler(mockAuth, { keyHash: "def456" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("different user");
    });

    it("returns error for nonexistent key", async () => {
      const result = await revokeKeyHandler(mockAuth, { keyHash: "nonexistent" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });

    it("rejects missing keyHash", async () => {
      const result = await revokeKeyHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("keyHash is required");
    });
  });

  describe("rotateKeyHandler", () => {
    it("atomically creates new key and grace-expires old key", async () => {
      // Seed old key
      mockKeyDocs["existing-key-hash-abc"] = {
        userId: "test-user-123",
        programId: "basher",
        label: "Old Key",
        capabilities: ["*"],
        active: true,
        createdAt: { toDate: () => new Date() },
      };

      const result = await rotateKeyHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.key).toMatch(/^cb_[0-9a-f]{64}$/);
      expect(data.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.graceWindowSeconds).toBe(30);
      expect(data.label).toBe("Old Key");

      // Verify runTransaction was called
      expect(mockDb.runTransaction).toHaveBeenCalled();

      // Verify new key exists with rotatedFrom
      const newKey = mockKeyDocs[data.keyHash];
      expect(newKey).toBeDefined();
      expect(newKey.rotatedFrom).toBe("existing-key-hash-abc");

      // Verify old key has rotatedTo and expiresAt
      const oldKey = mockKeyDocs["existing-key-hash-abc"];
      expect(oldKey.rotatedTo).toBe(data.keyHash);
      expect(oldKey.expiresAt).toBeDefined();
    });

    it("preserves capabilities and programId from old key", async () => {
      // Seed old key with specific capabilities
      mockKeyDocs["existing-key-hash-abc"] = {
        userId: "test-user-123",
        programId: "basher",
        label: "Old Key",
        capabilities: ["dispatch.read"],
        active: true,
        createdAt: { toDate: () => new Date() },
      };

      const result = await rotateKeyHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      // Verify new key has same capabilities
      const newKey = mockKeyDocs[data.keyHash];
      expect(newKey.capabilities).toEqual(["dispatch.read"]);
      expect(newKey.programId).toBe("basher");
    });

    it("fails if current key not found", async () => {
      // Don't seed any key
      await expect(rotateKeyHandler(mockAuth, {})).rejects.toThrow("Current key not found");
    });
  });

  describe("listKeysHandler", () => {
    it("returns metadata only, never raw keys", async () => {
      // Seed 3 keys (2 active, 1 revoked)
      mockKeyDocs["key1"] = {
        userId: "test-user-123",
        programId: "basher",
        label: "Key 1",
        capabilities: ["*"],
        active: true,
        createdAt: { toDate: () => new Date("2024-01-01") },
      };
      mockKeyDocs["key2"] = {
        userId: "test-user-123",
        programId: "vector",
        label: "Key 2",
        capabilities: ["dispatch.read"],
        active: true,
        createdAt: { toDate: () => new Date("2024-01-02") },
      };
      mockKeyDocs["key3"] = {
        userId: "test-user-123",
        programId: "iso",
        label: "Key 3",
        capabilities: ["*"],
        active: false,
        revokedAt: { toDate: () => new Date("2024-01-03") },
        createdAt: { toDate: () => new Date("2024-01-01") },
      };

      const result = await listKeysHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.count).toBe(2); // Only active keys

      // Verify no raw keys in response
      data.keys.forEach((key: any) => {
        expect(key.key).toBeUndefined();
        expect(key.rawKey).toBeUndefined();
        expect(key.keyHash).toBeDefined();
        expect(key.programId).toBeDefined();
        expect(key.label).toBeDefined();
        expect(key.capabilities).toBeDefined();
        expect(key.active).toBe(true);
        expect(key.createdAt).toBeDefined();
      });
    });

    it("includes revoked keys when includeRevoked=true", async () => {
      // Seed 3 keys (2 active, 1 revoked)
      mockKeyDocs["key1"] = {
        userId: "test-user-123",
        programId: "basher",
        label: "Key 1",
        capabilities: ["*"],
        active: true,
        createdAt: { toDate: () => new Date() },
      };
      mockKeyDocs["key2"] = {
        userId: "test-user-123",
        programId: "vector",
        label: "Key 2",
        capabilities: ["*"],
        active: true,
        createdAt: { toDate: () => new Date() },
      };
      mockKeyDocs["key3"] = {
        userId: "test-user-123",
        programId: "iso",
        label: "Key 3",
        capabilities: ["*"],
        active: false,
        revokedAt: { toDate: () => new Date() },
        createdAt: { toDate: () => new Date() },
      };

      const result = await listKeysHandler(mockAuth, { includeRevoked: true });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.count).toBe(3);
    });

    it("handles empty key list", async () => {
      const result = await listKeysHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.count).toBe(0);
      expect(data.keys).toEqual([]);
    });
  });
});
