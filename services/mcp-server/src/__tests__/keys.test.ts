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
  getDefaultCapabilities: jest.fn(() => ["dispatch.read", "dispatch.write"]),
  WILDCARD_EQUIVALENT: ["dispatch.read", "dispatch.write", "keys.write"],
}));

// Owner-authz gate: default-allow so the existing create tests exercise the
// happy path. The gate's own logic (and the #341 capability ceiling) is covered
// in auth/ownerAuthz.test.ts; both are toggled per-test in the
// "createKeyHandler owner gate" block below.
jest.mock("../auth/ownerAuthz", () => ({
  isKeyProvisioner: jest.fn(() => true),
  disallowedMintCapabilities: jest.fn(() => []),
  KEY_PROVISION_CAPABILITY: "keys.provision",
  // BUG-009: NOT jest.fn() stubs — these are the real predicates, so the
  // authorization behaviour under test here is the shipped behaviour and not a
  // mock that always says yes. Their own unit tests live in ownerAuthz.test.ts.
  credentialPrincipal: (auth: any) => auth.keyProgramId ?? auth.programId,
  isKeyAdmin: (auth: any) => Array.isArray(auth.capabilities) && auth.capabilities.includes("fleet.admin"),
}));

// Tenant resolution: alternate uid -> canonical uid, set per test. Identity by default.
const mockAlternates: Record<string, string> = {};
jest.mock("../auth/tenant-resolver", () => {
  const actual = jest.requireActual("../auth/tenant-resolver");
  return {
    ...actual,
    resolveTenant: jest.fn(async (uid: string) => {
      const canonical = mockAlternates[uid];
      return canonical ? { tenantId: canonical, canonical: false, mergedFrom: uid } : { tenantId: uid, canonical: true };
    }),
    tenantUids: jest.fn(async (tenantId: string) => [
      tenantId,
      ...Object.entries(mockAlternates).filter(([, c]) => c === tenantId).map(([a]) => a),
    ]),
  };
});

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
  keyProgramId: "orchestrator",
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

// BUG-009 / RD-5 PR-F: a key-admin caller (literal fleet.admin on the credential; the program name confers nothing) — the only kind that may see or revoke other programs' keys.
const adminAuth: AuthContext = {
  ...mockAuth,
  keyProgramId: "vector" as any,
  capabilities: ["*", "fleet.admin"],
};

describe("Keys Module Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockKeyDocs).forEach((key) => delete mockKeyDocs[key]);
    Object.keys(mockAlternates).forEach((key) => delete mockAlternates[key]);
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

    it("falls back to WILDCARD_EQUIVALENT (named, no wildcard) when no defaults and no capabilities provided", async () => {
      const { getDefaultCapabilities } = require("../middleware/capabilities");
      (getDefaultCapabilities as jest.Mock).mockReturnValueOnce([]);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Fallback",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.capabilities).toEqual(["dispatch.read", "dispatch.write", "keys.write"]);
      expect(data.capabilities).not.toContain("*");
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

    it("C-2: default TTL sets expiresAt ~90 days from now", async () => {
      const before = Date.now();
      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Default TTL Key",
      });
      const after = Date.now();

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const storedDoc = mockKeyDocs[data.keyHash];
      expect(storedDoc.expiresAt).toBeDefined();
      const expiresMs = storedDoc.expiresAt.toMillis();
      const expectedLow = before + 90 * 24 * 60 * 60 * 1000;
      const expectedHigh = after + 90 * 24 * 60 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(expectedLow - 1000);
      expect(expiresMs).toBeLessThanOrEqual(expectedHigh + 1000);
    });

    it("C-2: ttlDays:0 creates non-expiring key (no expiresAt)", async () => {
      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Non-expiring Key",
        ttlDays: 0,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const storedDoc = mockKeyDocs[data.keyHash];
      expect(storedDoc.expiresAt).toBeUndefined();
    });
  });

  describe("createKeyHandler owner gate (SARK fesTTlPTC + #341 ceiling)", () => {
    const { isKeyProvisioner, disallowedMintCapabilities } = require("../auth/ownerAuthz");
    const { registerProgram } = require("../modules/programRegistry");

    it("rejects a caller that is not a key provisioner", async () => {
      (isKeyProvisioner as jest.Mock).mockReturnValueOnce(false);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Should Not Mint",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Forbidden");
      // No key written, no side effects (program registration) when denied.
      expect(Object.keys(mockKeyDocs)).toHaveLength(0);
      expect(registerProgram).not.toHaveBeenCalled();
    });

    it("denies BEFORE the missing-field checks (gate is first)", async () => {
      (isKeyProvisioner as jest.Mock).mockReturnValueOnce(false);

      // Missing programId AND label — gate must win, not the field validators.
      const result = await createKeyHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Forbidden");
    });

    it("allows a permitted provisioner to mint", async () => {
      (isKeyProvisioner as jest.Mock).mockReturnValueOnce(true);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Permitted",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.key).toMatch(/^cb_[0-9a-f]{64}$/);
    });

    it("rejects when requested caps exceed the caller's ceiling (#341 clamp), no side effects", async () => {
      (isKeyProvisioner as jest.Mock).mockReturnValueOnce(true);
      // Caller is a provisioner but does NOT hold relay.write.
      (disallowedMintCapabilities as jest.Mock).mockReturnValueOnce(["relay.write"]);

      const result = await createKeyHandler(mockAuth, {
        programId: "basher",
        label: "Over-broad",
        capabilities: ["dispatch.read", "relay.write"],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Forbidden");
      expect(data.error).toContain("relay.write");
      // Ceiling is enforced before any write / program registration.
      expect(Object.keys(mockKeyDocs)).toHaveLength(0);
      expect(registerProgram).not.toHaveBeenCalled();
    });
  });

  describe("revokeKeyHandler", () => {
    it("soft revokes an existing key", async () => {
      // Seed a key belonging to the CALLER's own program. BUG-009: revoking your
      // own key is the legitimate path; this test previously seeded programId
      // "basher" against an "orchestrator" caller, i.e. it asserted the
      // cross-program revoke that was the vulnerability.
      mockKeyDocs["abc123"] = {
        userId: "test-user-123",
        programId: "orchestrator",
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
      expect(data.error).toBe("Key not found"); // a tenant mismatch is indistinguishable from a missing key
      expect(mockKeyDocs["def456"].active).toBe(true);
    });

    it("BUG-009: DENIES revoking another program's key, naming the true principal", async () => {
      mockKeyDocs["victim"] = {
        userId: "test-user-123", // same tenant — the old guard passed on this alone
        programId: "vector",
        label: "Someone else's key",
        active: true,
        createdAt: { toDate: () => new Date() },
      };

      const result = await revokeKeyHandler(mockAuth, { keyHash: "victim" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("orchestrator");
      expect(data.error).toContain("vector");
      // The key must remain usable — this is the fleet kill switch.
      expect(mockKeyDocs["victim"].active).toBe(true);
      expect(mockKeyDocs["victim"].revokedAt).toBeUndefined();
    });

    it("BUG-009: a divergent auth.programId does NOT authorize a foreign revoke", async () => {
      mockKeyDocs["victim2"] = {
        userId: "test-user-123", programId: "vector", label: "Victim",
        active: true, createdAt: { toDate: () => new Date() },
      };

      // Credential is radia; auth.programId reads vector. The principal is keyProgramId.
      const forged: AuthContext = {
        ...mockAuth,
        keyProgramId: "radia" as any,
        capabilities: ["*"],
      };

      const result = await revokeKeyHandler(forged, { keyHash: "victim2" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("radia");
      expect(mockKeyDocs["victim2"].active).toBe(true);
    });

    it("BUG-009: a key admin MAY revoke a foreign key", async () => {
      mockKeyDocs["target"] = {
        userId: "test-user-123", programId: "basher", label: "Target",
        active: true, createdAt: { toDate: () => new Date() },
      };

      const result = await revokeKeyHandler(adminAuth, { keyHash: "target" });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockKeyDocs["target"].active).toBe(false);
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

  describe("RD-5 PR-E tenant resolution on the key path", () => {
    // mockAuth: tenant "test-user-123", program "orchestrator", wildcard (not fleet admin)
    const seed = (hash: string, userId: string, programId: string) => {
      mockKeyDocs[hash] = { userId, programId, label: hash, active: true, capabilities: ["x"], createdAt: { toDate: () => new Date() } };
    };

    it("lists and revokes a same-program key whose raw userId is an alternate of the caller's tenant", async () => {
      mockAlternates["alt-uid"] = "test-user-123";
      seed("alt-key", "alt-uid", "orchestrator");
      const list = JSON.parse((await listKeysHandler(mockAuth, {})).content[0].text);
      expect(list.keys.map((k: any) => k.keyHash)).toEqual(["alt-key"]);
      const rev = JSON.parse((await revokeKeyHandler(mockAuth, { keyHash: "alt-key" })).content[0].text);
      expect(rev.success).toBe(true);
      expect(mockKeyDocs["alt-key"].active).toBe(false);
    });

    it("never lists another tenant's keys, even for a key admin, and answers revoke with Key not found", async () => {
      seed("own", "test-user-123", "vector");
      seed("foreign-same-program", "other-tenant", "vector");
      const admin = { ...mockAuth, programId: "vector", keyProgramId: "vector", capabilities: ["fleet.admin"] } as AuthContext;
      const list = JSON.parse((await listKeysHandler(admin, {})).content[0].text);
      expect(list.keys.map((k: any) => k.keyHash)).toEqual(["own"]);
      const rev = JSON.parse((await revokeKeyHandler(admin, { keyHash: "foreign-same-program" })).content[0].text);
      expect(rev).toEqual({ success: false, error: "Key not found" });
      expect(mockKeyDocs["foreign-same-program"].active).toBe(true);
    });

    it("a fleet.admin holder lists the whole resolved tenant including alternate-uid keys", async () => {
      mockAlternates["alt-uid"] = "test-user-123";
      seed("a", "test-user-123", "iso");
      seed("b", "alt-uid", "dispatcher");
      seed("c", "other-tenant", "iso");
      const admin = { ...mockAuth, capabilities: ["fleet.admin"] } as AuthContext;
      const list = JSON.parse((await listKeysHandler(admin, {})).content[0].text);
      expect(list.keys.map((k: any) => k.keyHash).sort()).toEqual(["a", "b"]);
    });

    it("a failed tenant lookup returns a retryable error and changes nothing", async () => {
      const { resolveTenant } = jest.requireMock("../auth/tenant-resolver");
      const { TenantResolutionError } = jest.requireActual("../auth/tenant-resolver");
      seed("own", "test-user-123", "orchestrator");
      const original = (resolveTenant as jest.Mock).getMockImplementation()!;
      (resolveTenant as jest.Mock).mockRejectedValue(new TenantResolutionError("test-user-123", new Error("unavailable")));
      const err = jest.spyOn(console, "error").mockImplementation(() => {});
      let rev, list;
      try {
        rev = JSON.parse((await revokeKeyHandler(mockAuth, { keyHash: "own" })).content[0].text);
        list = JSON.parse((await listKeysHandler(mockAuth, {})).content[0].text);
      } finally {
        err.mockRestore();
        (resolveTenant as jest.Mock).mockImplementation(original);
      }
      expect(rev).toEqual({ success: false, error: "tenant resolution failed", retryable: true });
      expect(list).toEqual({ success: false, error: "tenant resolution failed", retryable: true });
      expect(mockKeyDocs["own"].active).toBe(true);
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

      // BUG-009: enumerating OTHER programs' keys is now an admin-only view.
      // The intent of this test is the response SHAPE (metadata only, never raw
      // keys), so it runs as an admin caller; the non-admin scoping is asserted
      // by its own test below.
      const result = await listKeysHandler(adminAuth, {});

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

      const result = await listKeysHandler(adminAuth, { includeRevoked: true });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.count).toBe(3);
    });

    it("BUG-009: a non-admin caller sees ONLY its own keys, not a fleet inventory", async () => {
      mockKeyDocs["own"] = {
        userId: "test-user-123", programId: "orchestrator", label: "Mine",
        capabilities: ["*"], active: true, createdAt: { toDate: () => new Date() },
      };
      mockKeyDocs["foreign1"] = {
        userId: "test-user-123", programId: "basher", label: "Not mine",
        capabilities: ["*"], active: true, createdAt: { toDate: () => new Date() },
      };
      mockKeyDocs["foreign2"] = {
        userId: "test-user-123", programId: "vector", label: "Not mine either",
        capabilities: ["*"], active: true, createdAt: { toDate: () => new Date() },
      };

      const result = await listKeysHandler(mockAuth, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
      expect(data.keys[0].keyHash).toBe("own");
      // keyHash is exactly the argument keys_revoke_key takes — leaking the
      // inventory is what made the revoke chain reachable.
      const hashes = data.keys.map((k: any) => k.keyHash);
      expect(hashes).not.toContain("foreign1");
      expect(hashes).not.toContain("foreign2");
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
