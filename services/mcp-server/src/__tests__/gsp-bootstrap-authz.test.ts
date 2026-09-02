/**
 * gsp_bootstrap authz gate — PR-3 (PDR-cachebash-authz-chokepoint,
 * ISO plan §3 PR-3: "gsp_bootstrap gating + explicit memory omission + new
 * literal fleet-read capability", R3/R4/R4a/R5).
 *
 * Covers the plan's §4 verification-matrix rows owned by PR-3 that can be
 * proven as unit/integration tests against this code directly (A6's live boot
 * probe and A13's live serving-revision read are explicitly out of scope for
 * a local test — see the PR description):
 *
 *   A1  — a restricted key requesting another program's bootstrap is DENIED,
 *         and the denial names the true principal.
 *   A2  — a key requesting its OWN bootstrap gets the full payload INCLUDING
 *         memory. This is the one that bricks the fleet if reversed.
 *   A3  — a fleet.observe-holding key requesting a foreign bootstrap
 *         SUCCEEDS, but memory is omitted with an explicit stated reason —
 *         proven against real seeded memory data, not merely absent data.
 *   A12 — a ["*"]-holding key is DENIED at this site (the radia shape).
 *   A13 — AUTH_MODE assertion (assertAuthModeAtBoot), tested directly.
 *   A14 — a key holding the OLD `fleet.read` capability (not `fleet.observe`)
 *         is DENIED, proving the check is the new literal capability and not
 *         the wildcard-satisfiable existing one.
 *
 * Plus the R4a-specific regression this plan calls out as the single most
 * important property: identity binds to credentialPrincipal (keyProgramId),
 * never to auth.programId alone, which is forgeable via X-Program-Id
 * (BUG-006) and — under hybrid/gsp_identity mode — recomputes
 * auth.capabilities too.
 */
import type { AuthContext } from "../auth/authValidator";
import { assertAuthModeAtBoot } from "../auth/authValidator";
import { gspBootstrapHandler } from "../modules/gsp";

// ── Minimal in-memory Firestore mock (subset of gsp.test.ts's pattern) ──────

let mockDocs: Record<string, any> = {};

function seedDoc(path: string, data: any) {
  mockDocs[path] = { ...data };
}

function parse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function buildQuery(colPath: string) {
  const prefix = colPath.endsWith("/") ? colPath : colPath + "/";
  let filters: Array<(data: any) => boolean> = [];
  let orderByField: string | null = null;
  let orderDir: "asc" | "desc" = "asc";
  let limitN: number | null = null;

  const chain: any = {
    where(field: string, op: string, value: any) {
      filters.push((data: any) => {
        const v = data[field];
        switch (op) {
          case "==": return v === value;
          case "!=": return v !== value;
          case "in": return Array.isArray(value) && value.includes(v);
          default: return true;
        }
      });
      return chain;
    },
    orderBy(field: string, dir?: string) {
      orderByField = field;
      orderDir = (dir as any) || "asc";
      return chain;
    },
    limit(n: number) {
      limitN = n;
      return chain;
    },
    async get() {
      let docs = Object.entries(mockDocs)
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map(([p, data]) => ({ id: p.slice(prefix.length), path: p, data }))
        .filter(({ data }) => filters.every((f) => f(data)));

      if (orderByField) {
        const field = orderByField;
        const dir = orderDir;
        docs.sort((a, b) => {
          const av = a.data[field];
          const bv = b.data[field];
          if (av < bv) return dir === "asc" ? -1 : 1;
          if (av > bv) return dir === "asc" ? 1 : -1;
          return 0;
        });
      }
      if (limitN !== null) docs = docs.slice(0, limitN);

      return {
        docs: docs.map((d) => ({ id: d.id, exists: true, data: () => d.data })),
        empty: docs.length === 0,
        size: docs.length,
      };
    },
  };
  return chain;
}

function makeMockDocRef(path: string) {
  return {
    async get() {
      const data = mockDocs[path];
      return { exists: data !== undefined, id: path.split("/").pop(), data: () => data };
    },
  };
}

const mockDb = {
  doc(path: string) {
    return makeMockDocRef(path);
  },
  collection(path: string) {
    return buildQuery(path);
  },
};

jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../middleware/capabilities", () => ({
  getDefaultCapabilities: jest.fn(() => ["*"]),
}));

jest.mock("../modules/events", () => ({
  emitEvent: jest.fn(),
}));

// ── Auth fixture helper ──────────────────────────────────────────────────────

const USER_ID = "test-user-123";

function authFor(opts: {
  programId: string;
  keyProgramId?: string;
  capabilities: string[];
}): AuthContext {
  return {
    userId: USER_ID,
    apiKeyHash: "test-key-hash",
    programId: opts.programId as any,
    keyProgramId: (opts.keyProgramId ?? opts.programId) as any,
    encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
    capabilities: opts.capabilities,
    rateLimitTier: "internal",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocs = {};

  // Target program identity, for every scenario that reads "iso"'s bootstrap.
  seedDoc(`tenants/${USER_ID}/programs/iso`, {
    programId: "iso",
    displayName: "ISO",
    role: "orchestrator",
    groups: ["council"],
    tags: [],
    active: true,
  });

  // Real memory data for "iso" — present in Firestore so a denied/omitted
  // read can be proven to be SUPPRESSION, not absence.
  seedDoc(`tenants/${USER_ID}/sessions/_meta/program_state/iso`, {
    learnedPatterns: [
      {
        id: "p1",
        domain: "orchestration",
        pattern: "Always confirm A2 before deploying an authz PR",
        confidence: 0.95,
        evidence: "This plan's own §6 rollback section",
        discoveredAt: "2026-09-01T00:00:00Z",
        stale: false,
      },
    ],
    contextSummary: {
      lastTask: { taskId: "t1", title: "authz sweep", outcome: "in_progress", notes: "PR-3" },
      activeWorkItems: ["gsp_bootstrap gate"],
      handoffNotes: "top secret handoff notes",
      openQuestions: [],
    },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A2 — self-read: full payload INCLUDING memory. The one that bricks the
// fleet if it's wrong, so it gets its own prominent block.
// ═════════════════════════════════════════════════════════════════════════════

describe("A2 — self-read returns the FULL payload including memory", () => {
  it("a restricted key (no fleet.observe, no wildcard) reading its OWN bootstrap succeeds with memory intact", async () => {
    const auth = authFor({ programId: "iso", capabilities: ["gsp.write"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso", depth: "standard" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.payload.identity.role).toBe("orchestrator");
    expect(data.payload.memory.omitted).not.toBe(true);
    expect(data.payload.memory.omittedReason).toBeUndefined();
    expect(data.payload.memory.learnedPatterns).toHaveLength(1);
    expect(data.payload.memory.learnedPatterns[0].id).toBe("p1");
    expect(data.payload.memory.contextSummary.handoffNotes).toBe("top secret handoff notes");
  });

  it("self-read succeeds even holding ZERO capabilities — self-access never depends on fleet.observe", async () => {
    const auth = authFor({ programId: "iso", capabilities: [] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.payload.memory.learnedPatterns).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A1 — restricted key requesting another program's bootstrap: DENIED, and the
// denial names the true principal.
// ═════════════════════════════════════════════════════════════════════════════

describe("A1 — a restricted key reading a FOREIGN bootstrap is DENIED, naming the true principal", () => {
  it("denies and names the principal", async () => {
    const auth = authFor({ programId: "basher", capabilities: ["gsp.write"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("FORBIDDEN");
    expect(data.principal).toBe("basher");
    expect(data.requestedAgentId).toBe("iso");
    expect(data.message).toContain("basher");
    expect(data.message).toContain("iso");
  });

  it("does not leak iso's memory (or anything else) in a denial", async () => {
    const auth = authFor({ programId: "basher", capabilities: [] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.payload).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A3 — fleet.observe-holding key reading a FOREIGN bootstrap: SUCCEEDS, but
// memory is omitted with an explicit stated reason.
// ═════════════════════════════════════════════════════════════════════════════

describe("A3 — fleet.observe grants the foreign read, but memory is explicitly omitted", () => {
  it("succeeds, and memory is omitted with a stated reason — proven against REAL seeded memory data", async () => {
    const auth = authFor({ programId: "vector", capabilities: ["*", "fleet.observe"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso", depth: "standard" });
    const data = parse(result);

    expect(data.success).toBe(true);
    // Non-memory sections are populated — this is a genuine foreign read, not
    // a synthesized/empty response.
    expect(data.payload.identity.role).toBe("orchestrator");

    // Memory is explicitly, positively withheld — not silently empty.
    expect(data.payload.memory.omitted).toBe(true);
    expect(typeof data.payload.memory.omittedReason).toBe("string");
    expect(data.payload.memory.omittedReason.length).toBeGreaterThan(0);
    // The reason names the actual principal, not a generic message.
    expect(data.payload.memory.omittedReason).toContain("vector");

    // The suppression is proven against data that genuinely exists — iso's
    // seeded pattern ("p1") and handoff notes are NOT present in the response.
    expect(data.payload.memory.learnedPatterns).toEqual([]);
    expect(data.payload.memory.contextSummary.handoffNotes).toBe("");
    expect(JSON.stringify(data.payload)).not.toContain("top secret handoff notes");
  });

  it("a bounded key holding ONLY fleet.observe (no wildcard) can still read foreign identity", async () => {
    const auth = authFor({ programId: "sark", capabilities: ["fleet.observe"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.payload.memory.omitted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A12 — a ["*"]-holding key (the radia shape: wildcard, no fleet.observe) is
// DENIED at this specific site. Not a sample — this exact site, every time.
// ═════════════════════════════════════════════════════════════════════════════

describe('A12 — a ["*"] wildcard key WITHOUT fleet.observe is DENIED here', () => {
  it("denies radia-shaped wildcard key reading a foreign bootstrap", async () => {
    const auth = authFor({ programId: "radia", capabilities: ["*"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("FORBIDDEN");
    expect(data.principal).toBe("radia");
  });

  it("proves the gate is NOT routed through hasCapability (which would admit '*')", async () => {
    // If this gate were accidentally written as hasFleetObserveCapability
    // using the wildcard-expanding matcher (auth/... hasCapability, or
    // middleware/capabilities.ts's hasCapability), this test fails — a bare
    // ["*"] would pass. It must not.
    const auth = authFor({ programId: "casp", capabilities: ["*"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);
    expect(data.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A14 — a key holding the OLD `fleet.read` capability (not `fleet.observe`)
// is DENIED, proving the new capability is genuinely new and literal.
// ═════════════════════════════════════════════════════════════════════════════

describe("A14 — legacy fleet.read does NOT confer the new fleet.observe gate", () => {
  it("denies a key holding fleet.read but not fleet.observe", async () => {
    const auth = authFor({ programId: "mobile-client", capabilities: ["fleet.read", "programs.read"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("FORBIDDEN");
  });

  it("denies even a key holding fleet.read AND wildcard-adjacent capabilities, absent the literal grant", async () => {
    const auth = authFor({
      programId: "legacy-fleet-reader",
      capabilities: ["fleet.read", "dispatch.read", "relay.read", "state.read"],
    });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    expect(parse(result).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// R4a — identity binds to credentialPrincipal (keyProgramId), never to
// auth.programId alone. The plan calls this "the single most important
// paragraph in this plan": a capability may only WIDEN an already
// principal-bound decision, never establish identity by itself.
// ═════════════════════════════════════════════════════════════════════════════

describe("R4a — capabilities widen an identity decision, they never establish it", () => {
  it("an X-Program-Id-forged auth.programId does NOT grant a self-read — binds to keyProgramId", async () => {
    // Attacker's credential is radia; the X-Program-Id header (BUG-006) has
    // forged auth.programId to "iso" — the exact subject being requested.
    // If the gate used auth.programId instead of credentialPrincipal, this
    // would incorrectly read as a self-read and return full memory.
    const auth = authFor({ programId: "iso", keyProgramId: "radia", capabilities: ["*"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);

    expect(data.success).toBe(false);
    // The denial must name the TRUE credential (radia), not the forged claim.
    expect(data.principal).toBe("radia");
  });

  it("a header-recomputed '*' (hybrid-mode orchestrator role escalation) still does not satisfy the literal fleet.observe check", async () => {
    // Simulates the BUG-006 shape: under hybrid mode, auth.capabilities gets
    // recomputed to the header-named program's role. Even in the worst case —
    // recomputed to orchestrator's ["*"] — fleet.observe is a named grant on
    // exactly two principals, never a DEFAULT_CAPABILITIES role member, so
    // this must still deny.
    const auth = authFor({ programId: "iso", keyProgramId: "radia", capabilities: ["*"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso", depth: "full" });
    expect(parse(result).success).toBe(false);
  });

  it("credentialPrincipal, not the header override, is who gets fleet.observe's benefit too", async () => {
    // vector's OWN key (keyProgramId=vector) legitimately holds fleet.observe.
    // Even if some transport recomputed auth.programId to something else, the
    // foreign-read grant still resolves off the credential's own capabilities.
    const auth = authFor({ programId: "some-other-role", keyProgramId: "vector", capabilities: ["*", "fleet.observe"] });
    const result = await gspBootstrapHandler(auth, { agentId: "iso" });
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.payload.memory.omitted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A13 — AUTH_MODE is asserted explicitly at boot, not silently inherited from
// the `|| 'key_identity'` fallback default.
// ═════════════════════════════════════════════════════════════════════════════

describe("A13 — assertAuthModeAtBoot", () => {
  it('is NOT ok when AUTH_MODE is unset (the current serving-revision state per the plan)', () => {
    const result = assertAuthModeAtBoot({} as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.mode).toBeUndefined();
  });

  it('is NOT ok when AUTH_MODE is explicitly "hybrid" (the BUG-006-vulnerable mode)', () => {
    const result = assertAuthModeAtBoot({ AUTH_MODE: "hybrid" } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("hybrid");
  });

  it('is NOT ok for "gsp_identity" either — only the pinned literal value passes', () => {
    expect(assertAuthModeAtBoot({ AUTH_MODE: "gsp_identity" } as NodeJS.ProcessEnv).ok).toBe(false);
  });

  it('IS ok only when AUTH_MODE is explicitly "key_identity"', () => {
    const result = assertAuthModeAtBoot({ AUTH_MODE: "key_identity" } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("key_identity");
  });

  it("logs a loud [BOOT][SECURITY] warning (not a silent pass) when not pinned", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    assertAuthModeAtBoot({} as NodeJS.ProcessEnv);
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toContain("[BOOT][SECURITY]");
    errSpy.mockRestore();
  });
});
