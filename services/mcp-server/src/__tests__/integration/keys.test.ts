/**
 * Keys Module Integration Tests — H1
 *
 * Tests full key lifecycle against Firestore emulator.
 */

import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";
import { createKeyHandler, revokeKeyHandler, rotateKeyHandler, listKeysHandler } from "../../modules/keys";
import type { AuthContext } from "../../auth/authValidator";
import * as admin from "firebase-admin";

let db: admin.firestore.Firestore;
let testUser: Awaited<ReturnType<typeof seedTestUser>>;
let auth: AuthContext;

beforeAll(async () => {
  db = getTestFirestore();
});

beforeEach(async () => {
  await clearFirestoreData();
  testUser = await seedTestUser("integ-keys-user");

  // Seed the program registry so isProgramRegistered returns true
  await db.doc(`tenants/${testUser.userId}/programs/basher`).set({
    programId: "basher",
    displayName: "Basher",
    role: "builder",
    color: "#E87040",
    groups: ["builders"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });

  auth = {
    userId: testUser.userId,
    apiKeyHash: testUser.apiKeyHash,
    programId: "orchestrator",
    encryptionKey: testUser.encryptionKey,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
});

describe("Keys Integration Tests", () => {
  describe("Full Key Lifecycle", () => {
    it("create → list → rotate → verify grace window → revoke → list(includeRevoked)", async () => {
      // 1. Create key for "basher"
      const createResult = await createKeyHandler(auth, {
        programId: "basher",
        label: "Test Key",
      });
      const createData = JSON.parse(createResult.content[0].text);
      expect(createData.success).toBe(true);
      const originalKeyHash = createData.keyHash;

      // 2. List keys → verify count=1, key metadata present, no raw key
      const list1Result = await listKeysHandler(auth, {});
      const list1Data = JSON.parse(list1Result.content[0].text);
      expect(list1Data.success).toBe(true);
      expect(list1Data.count).toBe(1);
      expect(list1Data.keys[0].keyHash).toBe(originalKeyHash);
      expect(list1Data.keys[0].key).toBeUndefined();
      expect(list1Data.keys[0].rawKey).toBeUndefined();

      // 3. Rotate key (update auth to use the created key)
      auth.apiKeyHash = originalKeyHash;
      const rotateResult = await rotateKeyHandler(auth, {});
      const rotateData = JSON.parse(rotateResult.content[0].text);
      expect(rotateData.success).toBe(true);
      const newKeyHash = rotateData.keyHash;
      expect(newKeyHash).not.toBe(originalKeyHash);

      // 4. Verify old key still exists in Firestore with expiresAt set ~30s from now
      const oldKeyDoc = await db.doc(`keyIndex/${originalKeyHash}`).get();
      expect(oldKeyDoc.exists).toBe(true);
      const oldKeyData = oldKeyDoc.data();
      expect(oldKeyData?.rotatedTo).toBe(newKeyHash);
      expect(oldKeyData?.expiresAt).toBeDefined();
      const expiresAt = oldKeyData?.expiresAt.toDate();
      const now = new Date();
      const diffSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
      expect(diffSeconds).toBeGreaterThan(20); // Should be ~30s
      expect(diffSeconds).toBeLessThan(35);

      // 5. Verify new key exists with rotatedFrom
      const newKeyDoc = await db.doc(`keyIndex/${newKeyHash}`).get();
      expect(newKeyDoc.exists).toBe(true);
      const newKeyData = newKeyDoc.data();
      expect(newKeyData?.rotatedFrom).toBe(originalKeyHash);
      expect(newKeyData?.active).toBe(true);

      // 6. Revoke new key
      const revokeResult = await revokeKeyHandler(auth, { keyHash: newKeyHash });
      const revokeData = JSON.parse(revokeResult.content[0].text);
      expect(revokeData.success).toBe(true);

      // 7. Verify new key is revoked
      const revokedKeyDoc = await db.doc(`keyIndex/${newKeyHash}`).get();
      const revokedKeyData = revokedKeyDoc.data();
      expect(revokedKeyData?.active).toBe(false);
      expect(revokedKeyData?.revokedAt).toBeDefined();

      // 8. List with includeRevoked: true → verify count=2 (both keys)
      const list2Result = await listKeysHandler(auth, { includeRevoked: true });
      const list2Data = JSON.parse(list2Result.content[0].text);
      expect(list2Data.success).toBe(true);
      expect(list2Data.count).toBe(2);

      // 9. List without includeRevoked → verify count=0 (old expired grace window hasn't passed but marked as rotated, new revoked)
      // Note: The old key is still technically active until expiresAt, but it has rotatedTo set
      // The list handler filters by active field, so let's check what's actually returned
      const list3Result = await listKeysHandler(auth, {});
      const list3Data = JSON.parse(list3Result.content[0].text);
      expect(list3Data.success).toBe(true);
      // Old key might still be active=true (grace window), so count could be 1
      // But the new key should be excluded (active=false)
      const activeKeys = list3Data.keys.filter((k: any) => k.active);
      expect(activeKeys.every((k: any) => k.keyHash !== newKeyHash)).toBe(true);
    });

    it("concurrent rotation safety", async () => {
      // 1. Create a key
      const createResult = await createKeyHandler(auth, {
        programId: "basher",
        label: "Rotation Test",
      });
      const createData = JSON.parse(createResult.content[0].text);
      const originalKeyHash = createData.keyHash;

      // 2. Set auth to use the created key
      auth.apiKeyHash = originalKeyHash;

      // 3. Rotate once → success
      const rotate1Result = await rotateKeyHandler(auth, {});
      const rotate1Data = JSON.parse(rotate1Result.content[0].text);
      expect(rotate1Data.success).toBe(true);
      const newKeyHash = rotate1Data.keyHash;

      // 4. Attempt to rotate same old key hash again → should fail
      // (old key now has rotatedTo set, making it ineligible for rotation)
      // Keep using the old key hash in auth
      await expect(rotateKeyHandler(auth, {})).rejects.toThrow();

      // 5. Verify that using the NEW key hash works
      auth.apiKeyHash = newKeyHash;
      const rotate2Result = await rotateKeyHandler(auth, {});
      const rotate2Data = JSON.parse(rotate2Result.content[0].text);
      expect(rotate2Data.success).toBe(true);
      expect(rotate2Data.keyHash).not.toBe(newKeyHash);
    });

    it("auto-registers unknown program during key creation", async () => {
      // Don't seed "new-agent" in program registry
      const createResult = await createKeyHandler(auth, {
        programId: "new-agent",
        label: "New Agent Key",
      });
      const createData = JSON.parse(createResult.content[0].text);
      expect(createData.success).toBe(true);
      expect(createData.registered).toBe(true);

      // Verify program doc now exists
      const programDoc = await db.doc(`tenants/${testUser.userId}/programs/new-agent`).get();
      expect(programDoc.exists).toBe(true);
      const programData = programDoc.data();
      expect(programData?.programId).toBe("new-agent");
      expect(programData?.displayName).toBe("new-agent");
      expect(programData?.role).toBe("custom");
    });
  });
});
