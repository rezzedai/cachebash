/**
 * Integration Test: WS-3 Boundary Circuit Breaker
 *
 * Runs against the real Firestore emulator (not mocked) to prove:
 * - The N+1th mutation in a rolling window is denied with a typed error
 *   while reads for the same key keep passing.
 * - The org-aggregate ceiling denies once exhausted, independent of any
 *   single key's own budget.
 * - The kill switch (`paused: true`) fails closed on the very next call.
 * - Fail-closed: a tenant with no `_meta/ceilings` doc denies mutations but
 *   allows reads.
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

// Point the module under test at the emulator-backed Firestore instance
// instead of the production firebase/client.ts singleton (which requires
// initializeFirebase() against real GCP credentials).
jest.mock("../../firebase/client.js", () => ({
  getFirestore: () => getTestFirestoreLazy(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}));

// signal.ts's sendAlertHandler does its own Firestore writes (relay + tasks
// collections) via the mocked client above, which is fine to let run for
// real against the emulator — no need to stub it for this test.

function getTestFirestoreLazy(): admin.firestore.Firestore {
  return getTestFirestore();
}

import {
  checkCircuitBreaker,
  resetCircuitBreakerState,
} from "../../middleware/circuitBreaker";
import type { AuthContext } from "../../auth/authValidator";

describe("WS-3 Circuit Breaker Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    resetCircuitBreakerState();
    const testUser = await seedTestUser("test-org-breaker");
    userId = testUser.userId;
  });

  function auth(overrides: Partial<AuthContext> = {}): AuthContext {
    return {
      userId,
      apiKeyHash: "test-key-hash",
      encryptionKey: Buffer.from("0123456789abcdef0123456789abcdef"),
      programId: "wingman" as any,
      capabilities: ["dispatch.read", "dispatch.write"],
      rateLimitTier: "free",
      ...overrides,
    };
  }

  async function setCeilings(overrides: Record<string, unknown>): Promise<void> {
    await db.doc(`tenants/${userId}/_meta/ceilings`).set({
      perKeyLimit: 3,
      orgLimit: 10,
      windowMs: 60_000,
      paused: false,
      ...overrides,
    });
  }

  it("allows exactly perKeyLimit mutations, denies the N+1th with a typed error, while reads keep passing", async () => {
    await setCeilings({ perKeyLimit: 3, orgLimit: 100 });
    const a = auth();

    const r1 = await checkCircuitBreaker(a, "dispatch_create_task");
    const r2 = await checkCircuitBreaker(a, "dispatch_create_task");
    const r3 = await checkCircuitBreaker(a, "dispatch_create_task");
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);

    // N+1th mutation — must be denied with a typed error code.
    const r4 = await checkCircuitBreaker(a, "dispatch_create_task");
    expect(r4.allowed).toBe(false);
    if (!r4.allowed) {
      expect(r4.code).toBe("CEILING_KEY_EXCEEDED");
      expect(typeof r4.message).toBe("string");
      expect(r4.message.length).toBeGreaterThan(0);
    }

    // Reads are unaffected by the tripped mutation ceiling.
    const readResult = await checkCircuitBreaker(a, "dispatch_get_tasks");
    expect(readResult.allowed).toBe(true);
  });

  it("denies once the org-aggregate ceiling is exhausted across distinct keys", async () => {
    await setCeilings({ perKeyLimit: 100, orgLimit: 2 });
    const keyA = auth({ apiKeyHash: "key-a" });
    const keyB = auth({ apiKeyHash: "key-b" });
    const keyC = auth({ apiKeyHash: "key-c" });

    expect((await checkCircuitBreaker(keyA, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(keyB, "dispatch_create_task")).allowed).toBe(true);

    const r3 = await checkCircuitBreaker(keyC, "dispatch_create_task");
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) expect(r3.code).toBe("CEILING_ORG_EXCEEDED");

    // Reads for the newly-blocked key still pass.
    expect((await checkCircuitBreaker(keyC, "dispatch_get_tasks")).allowed).toBe(true);
  });

  it("kill switch: org pause fails closed on the very next request", async () => {
    await setCeilings({ perKeyLimit: 100, orgLimit: 100, paused: false });
    const a = auth();

    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(true);

    // Flip the kill switch.
    await db.doc(`tenants/${userId}/_meta/ceilings`).set(
      { paused: true },
      { merge: true }
    );

    const paused = await checkCircuitBreaker(a, "dispatch_create_task");
    expect(paused.allowed).toBe(false);
    if (!paused.allowed) expect(paused.code).toBe("CEILING_ORG_PAUSED");

    // Every key for the tenant is affected, not just the one that tripped it.
    const otherKey = auth({ apiKeyHash: "another-key" });
    const pausedOther = await checkCircuitBreaker(otherKey, "dispatch_create_task");
    expect(pausedOther.allowed).toBe(false);
    if (!pausedOther.allowed) expect(pausedOther.code).toBe("CEILING_ORG_PAUSED");
  });

  it("fail-closed: denies mutations but allows reads when no ceilings doc exists for the tenant", async () => {
    // seedTestUser() seeds a generous ceilings doc so unrelated suites aren't
    // rate-limited by test infra (see setup.ts) — delete it here so this
    // test can exercise the true "no doc at all" fail-closed path.
    await db.doc(`tenants/${userId}/_meta/ceilings`).delete();
    const a = auth();

    const mutation = await checkCircuitBreaker(a, "dispatch_create_task");
    expect(mutation.allowed).toBe(false);
    if (!mutation.allowed) expect(mutation.code).toBe("CEILING_CONFIG_UNAVAILABLE");

    const read = await checkCircuitBreaker(a, "dispatch_get_tasks");
    expect(read.allowed).toBe(true);
  });

  it("recovers after the rolling window elapses", async () => {
    await setCeilings({ perKeyLimit: 1, orgLimit: 100, windowMs: 1_000 });
    const a = auth();

    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(true);
  });
});
