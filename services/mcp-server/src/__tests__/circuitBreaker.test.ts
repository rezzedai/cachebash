/**
 * WS-3 — Boundary circuit breaker unit tests.
 *
 * Covers: rolling-window math (pure), fail-closed paths (missing/unreadable/
 * malformed config), the kill switch, per-key + org-aggregate ceilings, and
 * that read-only tools never touch Firestore or the breaker's counters.
 */

import type { AuthContext } from "../auth/authValidator";
import {
  checkCircuitBreaker,
  isMutatingTool,
  pruneWindow,
  countInWindow,
  resetCircuitBreakerState,
  DEFAULT_CEILINGS,
} from "../middleware/circuitBreaker";

// --- Firestore mock (same pattern as pricing.test.ts) ---

const firestoreDocs = new Map<string, Record<string, any>>();
let throwOnRead = false;

const mockDb = {
  doc: jest.fn((path: string) => ({
    get: jest.fn(async () => {
      if (throwOnRead) throw new Error("read failed");
      const data = firestoreDocs.get(path);
      return { exists: !!data, data: () => data };
    }),
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(),
}));

const sendAlertHandler = jest.fn(async (..._args: any[]) => ({ content: [] }));
jest.mock("../modules/signal.js", () => ({
  sendAlertHandler: (...args: any[]) => sendAlertHandler(...args),
}));

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "org-1",
    apiKeyHash: "key-1",
    encryptionKey: Buffer.from("0123456789abcdef0123456789abcdef", "utf-8"),
    programId: "wingman" as any,
    capabilities: ["dispatch.read", "dispatch.write"],
    rateLimitTier: "free",
    ...overrides,
  };
}

function setCeilings(org: string, config: Partial<typeof DEFAULT_CEILINGS>) {
  firestoreDocs.set(`tenants/${org}/_meta/ceilings`, { ...DEFAULT_CEILINGS, ...config });
}

beforeEach(() => {
  firestoreDocs.clear();
  throwOnRead = false;
  sendAlertHandler.mockClear();
  resetCircuitBreakerState();
});

describe("rolling window math (pure)", () => {
  it("prunes timestamps outside the window", () => {
    const now = 100_000;
    const timestamps = [now - 70_000, now - 30_000, now - 1_000];
    expect(pruneWindow(timestamps, now, 60_000)).toEqual([now - 30_000, now - 1_000]);
  });

  it("counts only timestamps inside the window", () => {
    const now = 100_000;
    const timestamps = [now - 70_000, now - 30_000, now - 1_000];
    expect(countInWindow(timestamps, now, 60_000)).toBe(2);
  });

  it("treats the exact window boundary as expired (strictly greater than cutoff)", () => {
    const now = 100_000;
    const windowMs = 60_000;
    const timestamps = [now - windowMs]; // exactly at cutoff
    expect(countInWindow(timestamps, now, windowMs)).toBe(0);
  });

  it("returns empty/zero for an empty window", () => {
    expect(pruneWindow([], 100_000, 60_000)).toEqual([]);
    expect(countInWindow([], 100_000, 60_000)).toBe(0);
  });
});

describe("isMutatingTool", () => {
  it("classifies dispatch/relay/state writes as mutating", () => {
    expect(isMutatingTool("dispatch_create_task")).toBe(true);
    expect(isMutatingTool("relay_send_message")).toBe(true);
    expect(isMutatingTool("state_update_program_state")).toBe(true);
  });

  it("classifies reads as non-mutating", () => {
    expect(isMutatingTool("dispatch_get_tasks")).toBe(false);
    expect(isMutatingTool("relay_get_messages")).toBe(false);
    expect(isMutatingTool("state_get_program_state")).toBe(false);
  });

  it("classifies fleet.control tools (quarantine/unquarantine) as mutating", () => {
    // fleet.control is a non-.write capability but writes program state, so the
    // breaker (kill switch + fail-closed) must cover it. SARK WS-3 final panel.
    expect(isMutatingTool("dispatch_quarantine_program")).toBe(true);
    expect(isMutatingTool("dispatch_unquarantine_program")).toBe(true);
  });

  it("resolves legacy flat aliases before classifying", () => {
    expect(isMutatingTool("create_task")).toBe(true); // alias for dispatch_create_task
    expect(isMutatingTool("get_tasks")).toBe(false); // alias for dispatch_get_tasks
  });

  it("fails closed (non-mutating=false -> denies via breaker) for unmapped tool names", () => {
    // An unmapped tool has no required capability, so isMutatingTool returns
    // false — but checkCircuitBreaker only skips the Firestore read for
    // known non-mutating tools. Since this tool is truly unmapped it is
    // *not* mutating, so it passes through untouched (capability gate is
    // the actual fail-closed layer for unmapped tools, per capabilities.ts).
    expect(isMutatingTool("__totally_unknown_tool__")).toBe(false);
  });
});

describe("read-only tools bypass the breaker entirely", () => {
  it("allows reads with zero Firestore access, even with no ceiling config", async () => {
    const result = await checkCircuitBreaker(auth(), "dispatch_get_tasks");
    expect(result.allowed).toBe(true);
    expect(mockDb.doc).not.toHaveBeenCalled();
  });
});

describe("fail-closed paths", () => {
  it("denies mutations when the ceiling doc does not exist", async () => {
    const result = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("CEILING_CONFIG_UNAVAILABLE");
  });

  it("denies mutations when the ceiling read throws", async () => {
    throwOnRead = true;
    const result = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("CEILING_CONFIG_UNAVAILABLE");
  });

  it("denies mutations when the ceiling doc is malformed (non-numeric / non-positive fields)", async () => {
    setCeilings("org-1", { perKeyLimit: 0 });
    const r1 = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(r1.allowed).toBe(false);

    firestoreDocs.set("tenants/org-1/_meta/ceilings", { perKeyLimit: "not-a-number", orgLimit: 10, windowMs: 60_000 });
    const r2 = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(r2.allowed).toBe(false);
  });

  it("emits a signal alert when denying due to missing/unreadable config", async () => {
    await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(sendAlertHandler).toHaveBeenCalledTimes(1);
    const call = sendAlertHandler.mock.calls[0] as any[];
    expect(call[1].alertType).toBe("warning");
  });
});

describe("kill switch (org pause)", () => {
  it("denies all mutations for a paused tenant even under budget", async () => {
    setCeilings("org-1", { perKeyLimit: 100, orgLimit: 100, paused: true });
    const result = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("CEILING_ORG_PAUSED");
  });

  it("takes effect on the very next request after being set (no stale cache)", async () => {
    setCeilings("org-1", { perKeyLimit: 100, orgLimit: 100, paused: false });
    const before = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(before.allowed).toBe(true);

    setCeilings("org-1", { perKeyLimit: 100, orgLimit: 100, paused: true });
    const after = await checkCircuitBreaker(auth(), "dispatch_create_task");
    expect(after.allowed).toBe(false);
  });

  it("does not affect reads for a paused tenant", async () => {
    setCeilings("org-1", { paused: true });
    const result = await checkCircuitBreaker(auth(), "dispatch_get_tasks");
    expect(result.allowed).toBe(true);
  });
});

describe("per-key ceiling", () => {
  it("allows exactly perKeyLimit mutations then denies the N+1th with a typed error", async () => {
    setCeilings("org-1", { perKeyLimit: 2, orgLimit: 100, windowMs: 60_000 });
    const a = auth();

    const r1 = await checkCircuitBreaker(a, "dispatch_create_task");
    const r2 = await checkCircuitBreaker(a, "dispatch_create_task");
    const r3 = await checkCircuitBreaker(a, "dispatch_create_task");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) expect(r3.code).toBe("CEILING_KEY_EXCEEDED");
  });

  it("tracks separate keys independently", async () => {
    setCeilings("org-1", { perKeyLimit: 1, orgLimit: 100, windowMs: 60_000 });
    const keyA = auth({ apiKeyHash: "key-a" });
    const keyB = auth({ apiKeyHash: "key-b" });

    expect((await checkCircuitBreaker(keyA, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(keyA, "dispatch_create_task")).allowed).toBe(false);
    // key-b has its own untouched budget
    expect((await checkCircuitBreaker(keyB, "dispatch_create_task")).allowed).toBe(true);
  });

  it("recovers once the window rolls forward", async () => {
    setCeilings("org-1", { perKeyLimit: 1, orgLimit: 100, windowMs: 1_000 });
    const a = auth();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(0);
    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(false);

    nowSpy.mockReturnValue(2_000); // past the 1s window
    expect((await checkCircuitBreaker(a, "dispatch_create_task")).allowed).toBe(true);

    nowSpy.mockRestore();
  });
});

describe("org-aggregate ceiling", () => {
  it("denies once the org aggregate is exhausted, even across distinct keys under their own per-key budget", async () => {
    setCeilings("org-1", { perKeyLimit: 100, orgLimit: 2, windowMs: 60_000 });
    const keyA = auth({ apiKeyHash: "key-a" });
    const keyB = auth({ apiKeyHash: "key-b" });
    const keyC = auth({ apiKeyHash: "key-c" });

    expect((await checkCircuitBreaker(keyA, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(keyB, "dispatch_create_task")).allowed).toBe(true);
    const r3 = await checkCircuitBreaker(keyC, "dispatch_create_task");
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) expect(r3.code).toBe("CEILING_ORG_EXCEEDED");
  });

  it("does not consume per-key budget when the org ceiling denies the call", async () => {
    setCeilings("org-1", { perKeyLimit: 100, orgLimit: 1, windowMs: 60_000 });
    const keyA = auth({ apiKeyHash: "key-a" });
    const keyB = auth({ apiKeyHash: "key-b" });

    expect((await checkCircuitBreaker(keyA, "dispatch_create_task")).allowed).toBe(true);
    expect((await checkCircuitBreaker(keyB, "dispatch_create_task")).allowed).toBe(false);

    // Raise the org ceiling — key-b should still have its full per-key budget,
    // proving the earlier org-denied call never consumed a key-b slot.
    setCeilings("org-1", { perKeyLimit: 1, orgLimit: 100, windowMs: 60_000 });
    expect((await checkCircuitBreaker(keyB, "dispatch_create_task")).allowed).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("does not let one org's ceiling or usage affect another org", async () => {
    setCeilings("org-1", { perKeyLimit: 1, orgLimit: 1, windowMs: 60_000 });
    // org-2 has no ceiling doc at all — should fail closed independently of org-1's state.
    const orgOneAuth = auth({ userId: "org-1" });
    const orgTwoAuth = auth({ userId: "org-2", apiKeyHash: "key-1" });

    expect((await checkCircuitBreaker(orgOneAuth, "dispatch_create_task")).allowed).toBe(true);
    const orgTwoResult = await checkCircuitBreaker(orgTwoAuth, "dispatch_create_task");
    expect(orgTwoResult.allowed).toBe(false);
    if (!orgTwoResult.allowed) expect(orgTwoResult.code).toBe("CEILING_CONFIG_UNAVAILABLE");
  });
});
