/**
 * GSP Module — Unit Tests (53 cases)
 * Covers all 9 handlers: read, write, diff, bootstrap, seed, propose, subscribe, resolve, search
 */

import type { AuthContext } from "../auth/authValidator";
import {
  gspReadHandler,
  gspWriteHandler,
  gspDiffHandler,
  gspBootstrapHandler,
  gspSeedHandler,
  gspProposeHandler,
  gspSubscribeHandler,
  gspResolveHandler,
  gspSearchHandler,
} from "../modules/gsp";

// ── In-memory Firestore mock ────────────────────────────────────────────────

/** Flat doc store keyed by full path */
let mockDocs: Record<string, any> = {};

/** Helper: seed a doc into the mock store */
function seedDoc(path: string, data: any) {
  mockDocs[path] = { ...data };
}

/** Helper: parse handler result */
function parse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// Build a chainable query that filters mockDocs under a collection path
function buildQuery(colPath: string) {
  // Gather docs whose path starts with colPath + "/"
  const prefix = colPath.endsWith("/") ? colPath : colPath + "/";

  let filters: Array<(data: any, id: string) => boolean> = [];
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
          case ">": return v > value;
          case ">=": return v >= value;
          case "<": return v < value;
          case "<=": return v <= value;
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
        .map(([p, data]) => {
          const id = p.slice(prefix.length);
          return { id, path: p, data };
        })
        .filter(({ data }) => filters.every((f) => f(data, "")));

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
        docs: docs.map((d) => ({
          id: d.id,
          ref: makeMockDocRef(d.path),
          exists: true,
          data: () => d.data,
        })),
        empty: docs.length === 0,
        size: docs.length,
        forEach(cb: any) {
          this.docs.forEach(cb);
        },
      };
    },
  };
  return chain;
}

function makeMockDocRef(path: string) {
  return {
    _path: path,
    id: path.split("/").pop(),
    path,
    async get() {
      const data = mockDocs[path];
      return {
        exists: data !== undefined,
        id: path.split("/").pop(),
        ref: makeMockDocRef(path),
        data: () => (data !== undefined ? { ...data } : undefined),
      };
    },
    async set(data: any, opts?: any) {
      if (opts?.merge && mockDocs[path]) {
        mockDocs[path] = { ...mockDocs[path], ...data };
      } else {
        mockDocs[path] = { ...data };
      }
    },
    async update(data: any) {
      if (mockDocs[path]) {
        mockDocs[path] = { ...mockDocs[path], ...data };
      }
    },
    async delete() {
      delete mockDocs[path];
    },
  };
}

// Auto-increment ID counter for .doc() with no arg
let autoIdCounter = 0;

const mockDb = {
  doc(path: string) {
    return makeMockDocRef(path);
  },
  collection(path: string) {
    const q = buildQuery(path);
    // Add .doc() for creating new docs or referencing by id
    q.doc = (id?: string) => {
      const docId = id || `auto-id-${++autoIdCounter}`;
      return makeMockDocRef(`${path}/${docId}`);
    };
    // Add .listDocuments() for cross-namespace search
    q.listDocuments = async () => {
      const prefix = path.endsWith("/") ? path : path + "/";
      const childIds = new Set<string>();
      for (const key of Object.keys(mockDocs)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstSegment = rest.split("/")[0];
          if (firstSegment) childIds.add(firstSegment);
        }
      }
      return Array.from(childIds).map((id) => ({
        id,
        path: `${path}/${id}`,
      }));
    };
    return q;
  },
  async runTransaction(callback: (txn: any) => Promise<any>) {
    const txn = {
      async get(ref: any) {
        return ref.get();
      },
      set(ref: any, data: any, opts?: any) {
        if (opts?.merge && mockDocs[ref._path || ref.path]) {
          mockDocs[ref._path || ref.path] = { ...mockDocs[ref._path || ref.path], ...data };
        } else {
          mockDocs[ref._path || ref.path] = { ...data };
        }
      },
      update(ref: any, data: any) {
        const p = ref._path || ref.path;
        if (mockDocs[p]) {
          mockDocs[p] = { ...mockDocs[p], ...data };
        }
      },
    };
    return callback(txn);
  },
  batch() {
    const ops: Array<() => void> = [];
    return {
      set(ref: any, data: any) {
        ops.push(() => {
          mockDocs[ref._path || ref.path] = { ...data };
        });
      },
      update(ref: any, data: any) {
        ops.push(() => {
          const p = ref._path || ref.path;
          if (mockDocs[p]) mockDocs[p] = { ...mockDocs[p], ...data };
        });
      },
      delete(ref: any) {
        ops.push(() => {
          delete mockDocs[ref._path || ref.path];
        });
      },
      async commit() {
        ops.forEach((op) => op());
      },
    };
  },
};

// ── Jest mocks ──────────────────────────────────────────────────────────────

jest.mock("../firebase/client", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../modules/relay", () => ({
  sendMessageHandler: jest.fn(() =>
    Promise.resolve({ content: [{ type: "text", text: '{"success":true}' }] })
  ),
}));

jest.mock("../modules/webhookDispatcher", () => ({
  dispatchWebhook: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("../middleware/capabilities", () => ({
  getDefaultCapabilities: jest.fn(() => ["*"]),
}));

// ── Shared auth context ─────────────────────────────────────────────────────

const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "test-key-hash",
  programId: "vector" as any,
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockDocs = {};
  autoIdCounter = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// gspReadHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspReadHandler", () => {
  // #1
  it("reads a single entry by namespace + key", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/my-key", {
      key: "my-key",
      namespace: "runtime",
      value: { setting: true },
      tier: "operational",
      version: 3,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await gspReadHandler(mockAuth, { namespace: "runtime", key: "my-key" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.found).toBe(true);
    expect(data.entry.key).toBe("my-key");
    expect(data.entry.version).toBe(3);
  });

  // #2
  it("returns found=false for missing key", async () => {
    const result = await gspReadHandler(mockAuth, { namespace: "runtime", key: "nonexistent" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.found).toBe(false);
  });

  // #3
  it("scans namespace, returns all entries", async () => {
    for (let i = 0; i < 3; i++) {
      seedDoc(`tenants/test-user-123/gsp/runtime/entries/key-${i}`, {
        key: `key-${i}`,
        namespace: "runtime",
        value: i,
        tier: "operational",
        version: 1,
        updatedAt: `2026-01-0${i + 1}T00:00:00Z`,
      });
    }

    const result = await gspReadHandler(mockAuth, { namespace: "runtime" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.count).toBe(3);
  });

  // #4
  it("filters namespace scan by tier", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/a", {
      key: "a", namespace: "runtime", value: 1, tier: "operational", version: 1, updatedAt: "2026-01-01T00:00:00Z",
    });
    seedDoc("tenants/test-user-123/gsp/runtime/entries/b", {
      key: "b", namespace: "runtime", value: 2, tier: "operational", version: 1, updatedAt: "2026-01-02T00:00:00Z",
    });
    seedDoc("tenants/test-user-123/gsp/runtime/entries/c", {
      key: "c", namespace: "runtime", value: 3, tier: "architectural", version: 1, updatedAt: "2026-01-03T00:00:00Z",
    });

    const result = await gspReadHandler(mockAuth, { namespace: "runtime", tier: "operational" });
    const data = parse(result);

    expect(data.count).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspWriteHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspWriteHandler", () => {
  // #5
  it("writes operational entry with versioning", async () => {
    const result = await gspWriteHandler(mockAuth, {
      namespace: "runtime",
      key: "test-key",
      value: { foo: "bar" },
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.version).toBe(1);
    expect(data.action).toBe("created");
  });

  // #6
  it("increments version on update", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/test-key", {
      key: "test-key",
      namespace: "runtime",
      value: "old",
      tier: "operational",
      version: 2,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await gspWriteHandler(mockAuth, {
      namespace: "runtime",
      key: "test-key",
      value: "new",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.version).toBe(3);
    expect(data.action).toBe("updated");
  });

  // #7
  it("rejects constitutional tier writes (GOVERNANCE_VIOLATION)", async () => {
    const result = await gspWriteHandler(mockAuth, {
      namespace: "constitution",
      key: "rule-1",
      value: "new",
      tier: "constitutional",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("GOVERNANCE_VIOLATION");
    expect(data.hint).toBe("gsp_propose");
  });

  // #8
  it("rejects architectural tier writes", async () => {
    const result = await gspWriteHandler(mockAuth, {
      namespace: "architecture",
      key: "decision-1",
      value: "new",
      tier: "architectural",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("GOVERNANCE_VIOLATION");
    expect(data.hint).toBe("gsp_propose");
  });

  // #9
  it("rejects overwriting existing protected-tier entry", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/protected-key", {
      key: "protected-key",
      namespace: "runtime",
      value: "sacred",
      tier: "constitutional",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // The transaction throws when it detects a protected-tier overwrite
    await expect(
      gspWriteHandler(mockAuth, {
        namespace: "runtime",
        key: "protected-key",
        value: "overwrite-attempt",
      })
    ).rejects.toThrow("GOVERNANCE_VIOLATION");
  });

  // #10
  it("uses custom source when provided", async () => {
    const result = await gspWriteHandler(mockAuth, {
      namespace: "runtime",
      key: "src-test",
      value: "val",
      source: "custom-agent",
    });
    const data = parse(result);
    expect(data.success).toBe(true);

    // Verify the stored entry has updatedBy = custom-agent
    const stored = mockDocs["tenants/test-user-123/gsp/runtime/entries/src-test"];
    expect(stored.updatedBy).toBe("custom-agent");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspDiffHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspDiffHandler", () => {
  // #11
  it("returns changes since version", async () => {
    [1, 2, 3, 5].forEach((v) => {
      seedDoc(`tenants/test-user-123/gsp/runtime/entries/key-v${v}`, {
        key: `key-v${v}`,
        namespace: "runtime",
        value: `val-${v}`,
        tier: "operational",
        version: v,
        updatedAt: `2026-01-0${v}T00:00:00Z`,
      });
    });

    const result = await gspDiffHandler(mockAuth, { namespace: "runtime", sinceVersion: 2 });
    const data = parse(result);

    expect(data.success).toBe(true);
    // versions 3 and 5 are > 2
    expect(data.count).toBe(2);
    data.changes.forEach((c: any) => {
      expect(c.version).toBeGreaterThan(2);
    });
  });

  // #12
  it("returns changes since timestamp", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/old", {
      key: "old", namespace: "runtime", value: 1, tier: "operational", version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    seedDoc("tenants/test-user-123/gsp/runtime/entries/new", {
      key: "new", namespace: "runtime", value: 2, tier: "operational", version: 2,
      updatedAt: "2026-03-01T00:00:00Z",
    });

    const result = await gspDiffHandler(mockAuth, {
      namespace: "runtime",
      sinceTimestamp: "2026-02-01T00:00:00Z",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.count).toBe(1);
    expect(data.changes[0].key).toBe("new");
  });

  // #13
  it("returns empty when no changes", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/a", {
      key: "a", namespace: "runtime", value: 1, tier: "operational", version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await gspDiffHandler(mockAuth, { namespace: "runtime", sinceVersion: 999 });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.count).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspBootstrapHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspBootstrapHandler", () => {
  function seedBootstrapData() {
    // Program registry
    seedDoc("tenants/test-user-123/programs/basher", {
      programId: "basher",
      displayName: "Basher",
      role: "builder",
      groups: ["builders"],
      tags: ["code"],
      active: true,
    });

    // Constitutional entries with shared-execution-rules
    seedDoc("tenants/test-user-123/gsp/constitution/entries/shared-execution-rules", {
      key: "shared-execution-rules",
      namespace: "constitution",
      tier: "constitutional",
      version: 1,
      value: {
        hardRules: [
          { key: "rule-1", value: "No direct prod writes" },
          { key: "rule-2", value: "All PRs need review" },
          { key: "rule-3", value: "Tests required" },
          { key: "rule-4", value: "No secrets in code" },
        ],
        escalationPolicy: [
          { key: "escalation-1", value: "Page on-call for P0" },
        ],
      },
      updatedAt: "2026-01-01T00:00:00Z",
    });

    seedDoc("tenants/test-user-123/gsp/constitution/entries/guiding-light", {
      key: "guiding-light",
      namespace: "constitution",
      tier: "constitutional",
      version: 1,
      value: "Full guiding light content here that is very long and detailed...",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Architectural entries
    seedDoc("tenants/test-user-123/gsp/architecture/entries/decision-auth", {
      key: "decision-auth",
      namespace: "architecture",
      tier: "architectural",
      version: 1,
      value: "Use JWT for auth",
      description: "Auth decision",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    seedDoc("tenants/test-user-123/gsp/architecture/entries/service-api", {
      key: "service-api",
      namespace: "architecture",
      tier: "architectural",
      version: 1,
      value: "MCP over HTTP",
      description: "API service",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Tasks
    seedDoc("tenants/test-user-123/tasks/task-1", {
      target: "basher",
      title: "Fix bug",
      priority: "high",
      action: "queue",
      status: "created",
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Messages
    seedDoc("tenants/test-user-123/relay/msg-1", {
      target: "basher",
      source: "iso",
      message_type: "DIRECTIVE",
      message: "Deploy hotfix",
      status: "pending",
      priority: "high",
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Sessions
    seedDoc("tenants/test-user-123/sessions/sess-1", {
      programId: "basher",
      state: "active",
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Program state with learned patterns
    seedDoc("tenants/test-user-123/programs/basher/state", {
      learnedPatterns: [
        {
          id: "p1",
          domain: "testing",
          pattern: "Always mock Firestore",
          confidence: 0.9,
          evidence: "Works every time",
          discoveredAt: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ],
      contextSummary: {
        lastTask: { taskId: "t1", title: "Fix bug", outcome: "success", notes: "" },
        activeWorkItems: ["item-1"],
        handoffNotes: "Continue testing",
        openQuestions: ["What about edge cases?"],
      },
    });
  }

  // #14
  it("returns essential depth payload (minimal)", async () => {
    seedBootstrapData();

    const result = await gspBootstrapHandler(mockAuth, { agentId: "basher", depth: "essential" });
    const data = parse(result);

    expect(data.success).toBe(true);
    const payload = data.payload;

    // Constitutional: hardRules limited to 3
    expect(payload.constitutional.hardRules.length).toBeLessThanOrEqual(3);
    // Essential: escalationPolicy empty
    expect(payload.constitutional.escalationPolicy).toEqual([]);
    // Condensed digest used
    expect(payload.constitutional.guidingLightDigest).toContain("Core Tenets");

    // Architectural skipped for essential
    expect(payload.architectural.activeDecisions).toEqual([]);

    // Context limited to 10
    expect(payload.context.pendingTasks.length).toBeLessThanOrEqual(10);
  });

  // #15
  it("returns standard depth payload (default)", async () => {
    seedBootstrapData();

    const result = await gspBootstrapHandler(mockAuth, { agentId: "basher", depth: "standard" });
    const data = parse(result);

    expect(data.success).toBe(true);
    const payload = data.payload;

    expect(payload.constitutional.hardRules.length).toBeLessThanOrEqual(10);
    expect(payload.architectural.activeDecisions.length).toBeGreaterThan(0);
    // Guiding light digest used for standard
    expect(payload.constitutional.guidingLightDigest).toContain("Core Tenets");
  });

  // #16
  it("returns full depth payload (all data)", async () => {
    seedBootstrapData();

    // Use vector as agentId (orchestrator) to get proposals section
    seedDoc("tenants/test-user-123/programs/vector", {
      programId: "vector",
      displayName: "Vector",
      role: "orchestrator",
      groups: ["council"],
      tags: [],
      active: true,
    });

    const result = await gspBootstrapHandler(mockAuth, { agentId: "vector", depth: "full" });
    const data = parse(result);

    expect(data.success).toBe(true);
    const payload = data.payload;

    // All sections populated
    expect(payload.constitutional.hardRules.length).toBeGreaterThan(0);
    expect(payload.architectural.activeDecisions.length).toBeGreaterThan(0);
    // Full depth uses raw guiding light content from Firestore
    expect(payload.constitutional.guidingLightDigest).toContain("Full guiding light content");
  });

  // #17
  it("populates identity from program registry", async () => {
    seedBootstrapData();

    const result = await gspBootstrapHandler(mockAuth, { agentId: "basher", depth: "essential" });
    const data = parse(result);
    const payload = data.payload;

    expect(payload.identity.role).toBe("builder");
    expect(payload.identity.reportingChain).toEqual(["iso", "vector"]);
    expect(payload.identity.groups).toEqual(["builders"]);
  });

  // #18
  it("handles missing program gracefully", async () => {
    // No program doc seeded
    const result = await gspBootstrapHandler(mockAuth, { agentId: "unknown-agent", depth: "essential" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.payload.identity.role).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspSeedHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspSeedHandler", () => {
  const seedEntries = [
    { key: "rule-1", value: "No prod writes", tier: "constitutional" as const },
    { key: "rule-2", value: "All PRs reviewed", tier: "constitutional" as const },
    { key: "rule-3", value: "Tests required", tier: "constitutional" as const },
  ];

  // #19
  it("seeds constitutional entries (admin)", async () => {
    const result = await gspSeedHandler(mockAuth, {
      namespace: "constitution",
      entries: seedEntries,
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.seeded).toBe(3);
    expect(data.skipped).toBe(0);
  });

  // #20
  it("skips existing entries when overwrite=false", async () => {
    seedDoc("tenants/test-user-123/gsp/constitution/entries/rule-1", {
      key: "rule-1",
      namespace: "constitution",
      value: "existing",
      tier: "constitutional",
      version: 1,
    });

    const result = await gspSeedHandler(mockAuth, {
      namespace: "constitution",
      entries: seedEntries,
    });
    const data = parse(result);

    expect(data.seeded).toBe(2);
    expect(data.skipped).toBe(1);
  });

  // #21
  it("overwrites when overwrite=true", async () => {
    seedDoc("tenants/test-user-123/gsp/constitution/entries/rule-1", {
      key: "rule-1",
      namespace: "constitution",
      value: "existing",
      tier: "constitutional",
      version: 1,
    });

    const result = await gspSeedHandler(mockAuth, {
      namespace: "constitution",
      entries: seedEntries,
      overwrite: true,
    });
    const data = parse(result);

    expect(data.seeded).toBe(3);
    expect(data.skipped).toBe(0);
  });

  // #22
  it("rejects unauthorized programs", async () => {
    const restrictedAuth: AuthContext = {
      ...mockAuth,
      programId: "basher" as any,
      capabilities: ["dispatch.read"],
    };

    const result = await gspSeedHandler(restrictedAuth, {
      namespace: "constitution",
      entries: seedEntries,
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("UNAUTHORIZED");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspProposeHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspProposeHandler", () => {
  beforeEach(() => {
    // Seed a constitutional entry as proposal target
    seedDoc("tenants/test-user-123/gsp/constitution/entries/rule-1", {
      key: "rule-1",
      namespace: "constitution",
      value: "old-value",
      tier: "constitutional",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  // #23
  it("creates proposal with reviewers auto-assigned", async () => {
    const result = await gspProposeHandler(mockAuth, {
      namespace: "constitution",
      key: "rule-1",
      proposedValue: "new-value",
      rationale: "Improvement",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.reviewers).toContain("flynn");
    expect(data.expiresAt).toBeDefined();

    // Verify expiry is ~30 days from now
    const expiry = new Date(data.expiresAt).getTime();
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiry - now - thirtyDaysMs)).toBeLessThan(60000); // within 1 min

    // Verify sendMessageHandler was called for each reviewer
    const { sendMessageHandler } = require("../modules/relay");
    expect(sendMessageHandler).toHaveBeenCalled();
  });

  // #24
  it("assigns 'vector' as reviewer for architectural proposals", async () => {
    seedDoc("tenants/test-user-123/gsp/architecture/entries/adr-1", {
      key: "adr-1",
      namespace: "architecture",
      value: "old",
      tier: "architectural",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await gspProposeHandler(mockAuth, {
      namespace: "architecture",
      key: "adr-1",
      proposedValue: "new",
      rationale: "Better approach",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.reviewers).toEqual(["vector"]);
  });

  // #25
  it("enforces proposal quota (max 5 pending)", async () => {
    // Seed 5 pending proposals from "vector"
    for (let i = 0; i < 5; i++) {
      seedDoc(`tenants/test-user-123/gsp_proposals/prop-${i}`, {
        proposedBy: "vector",
        status: "pending",
        namespace: "constitution",
        key: `rule-${i + 10}`,
      });
    }

    const result = await gspProposeHandler(mockAuth, {
      namespace: "constitution",
      key: "rule-1",
      proposedValue: "new",
      rationale: "6th proposal",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("QUOTA_EXCEEDED");
  });

  // #26
  it("rejects duplicate proposals (same namespace/key/proposer)", async () => {
    seedDoc("tenants/test-user-123/gsp_proposals/existing-prop", {
      namespace: "constitution",
      key: "rule-1",
      proposedBy: "vector",
      status: "pending",
    });

    const result = await gspProposeHandler(mockAuth, {
      namespace: "constitution",
      key: "rule-1",
      proposedValue: "new",
      rationale: "Duplicate",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("DUPLICATE_PROPOSAL");
  });

  // #27
  it("rejects proposals to operational tier", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/config-a", {
      key: "config-a",
      namespace: "runtime",
      value: "v1",
      tier: "operational",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const result = await gspProposeHandler(mockAuth, {
      namespace: "runtime",
      key: "config-a",
      proposedValue: "v2",
      rationale: "Should use gsp_write",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("GOVERNANCE_VIOLATION");
  });

  // #28
  it("rejects proposals to non-existent namespace", async () => {
    const result = await gspProposeHandler(mockAuth, {
      namespace: "nonexistent",
      key: "anything",
      proposedValue: "val",
      rationale: "Test",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("NAMESPACE_NOT_FOUND");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspSubscribeHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspSubscribeHandler", () => {
  beforeEach(() => {
    // Seed at least 1 entry in runtime namespace
    seedDoc("tenants/test-user-123/gsp/runtime/entries/config-a", {
      key: "config-a",
      namespace: "runtime",
      value: "v1",
      tier: "operational",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  // #29
  it("subscribes with message callback", async () => {
    const result = await gspSubscribeHandler(mockAuth, { namespace: "runtime" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.callbackType).toBe("message");
  });

  // #30
  it("subscribes with specific key", async () => {
    const result = await gspSubscribeHandler(mockAuth, { namespace: "runtime", key: "my-key" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.key).toBe("my-key");
  });

  // #31
  it("subscribes with webhook callback", async () => {
    const result = await gspSubscribeHandler(mockAuth, {
      namespace: "runtime",
      callbackType: "webhook",
      callbackUrl: "https://example.com/hook",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.callbackType).toBe("webhook");
  });

  // #32
  it("rejects duplicate subscription", async () => {
    // First subscription
    await gspSubscribeHandler(mockAuth, { namespace: "runtime" });

    // Second (duplicate)
    const result = await gspSubscribeHandler(mockAuth, { namespace: "runtime" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("DUPLICATE_SUBSCRIPTION");
  });

  // #33
  it("unsubscribes an active subscription", async () => {
    // Subscribe first
    await gspSubscribeHandler(mockAuth, { namespace: "runtime" });

    // Unsubscribe
    const result = await gspSubscribeHandler(mockAuth, { namespace: "runtime", unsubscribe: true });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.action).toBe("unsubscribed");
  });

  // #34
  it("returns error when unsubscribing non-existent subscription", async () => {
    const result = await gspSubscribeHandler(mockAuth, { namespace: "runtime", unsubscribe: true });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  // #35
  it("rejects subscription to non-existent namespace", async () => {
    const result = await gspSubscribeHandler(mockAuth, { namespace: "empty-ns" });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("NAMESPACE_NOT_FOUND");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspResolveHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspResolveHandler", () => {
  const proposalId = "test-proposal-1";

  function seedPendingProposal(overrides: Record<string, any> = {}) {
    seedDoc(`tenants/test-user-123/gsp_proposals/${proposalId}`, {
      id: proposalId,
      namespace: "constitution",
      key: "rule-1",
      currentValue: "old",
      proposedValue: "new",
      proposedBy: "basher",
      status: "pending",
      reviewers: ["flynn"],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      version: 1,
      ...overrides,
    });
  }

  beforeEach(() => {
    // Seed the target constitutional entry
    seedDoc("tenants/test-user-123/gsp/constitution/entries/rule-1", {
      key: "rule-1",
      namespace: "constitution",
      value: "old",
      tier: "constitutional",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  // #36
  it("approves proposal and applies state atomically", async () => {
    seedPendingProposal();
    const flynnAuth: AuthContext = { ...mockAuth, programId: "iso" as any };
    // Actually the reviewer is "flynn", but flynn isn't a ValidProgramId in the type system.
    // The module checks proposal.reviewers.includes(auth.programId), so we need to match.
    // Override reviewers to include our programId for this test.
    seedPendingProposal({ reviewers: ["vector"] });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "approved",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.stateUpdated).toBe(true);

    // Verify GSP entry now has proposed value
    const entry = mockDocs["tenants/test-user-123/gsp/constitution/entries/rule-1"];
    expect(entry.value).toBe("new");
    expect(entry.version).toBe(2);
  });

  // #37
  it("rejects proposal (no state change)", async () => {
    seedPendingProposal({ reviewers: ["vector"] });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "rejected",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.stateUpdated).toBe(false);

    const proposal = mockDocs[`tenants/test-user-123/gsp_proposals/${proposalId}`];
    expect(proposal.status).toBe("rejected");
  });

  // #38
  it("withdraws proposal (only proposer can withdraw)", async () => {
    seedPendingProposal({ proposedBy: "vector" });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "withdrawn",
    });
    const data = parse(result);

    expect(data.success).toBe(true);
    const proposal = mockDocs[`tenants/test-user-123/gsp_proposals/${proposalId}`];
    expect(proposal.status).toBe("withdrawn");
  });

  // #39
  it("rejects withdrawal by non-proposer", async () => {
    seedPendingProposal({ proposedBy: "basher" });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "withdrawn",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("UNAUTHORIZED");
  });

  // #40
  it("rejects resolve by non-reviewer", async () => {
    seedPendingProposal({ reviewers: ["flynn"] });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "approved",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("UNAUTHORIZED");
  });

  // #41
  it("rejects resolve on already-resolved proposal", async () => {
    seedPendingProposal({ status: "approved", reviewers: ["vector"] });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "approved",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("PROPOSAL_ALREADY_RESOLVED");
  });

  // #42
  it("auto-expires expired proposal", async () => {
    seedPendingProposal({
      reviewers: ["vector"],
      expiresAt: "2020-01-01T00:00:00Z", // in the past
    });

    const result = await gspResolveHandler(mockAuth, {
      proposalId,
      decision: "approved",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("PROPOSAL_EXPIRED");
  });

  // #43
  it("returns error for nonexistent proposal", async () => {
    const result = await gspResolveHandler(mockAuth, {
      proposalId: "fake-id",
      decision: "approved",
    });
    const data = parse(result);

    expect(data.success).toBe(false);
    expect(data.error).toBe("PROPOSAL_NOT_FOUND");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// gspSearchHandler
// ═════════════════════════════════════════════════════════════════════════════

describe("gspSearchHandler", () => {
  beforeEach(() => {
    // Seed entries across namespaces for search tests
    seedDoc("tenants/test-user-123/gsp/runtime/entries/auth-rules", {
      key: "auth-rules",
      namespace: "runtime",
      value: { type: "bearer" },
      tier: "operational",
      description: "Authentication rules configuration",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "vector",
    });

    seedDoc("tenants/test-user-123/gsp/runtime/entries/cache-config", {
      key: "cache-config",
      namespace: "runtime",
      value: { ttl: 300, description: "auth cache settings" },
      tier: "operational",
      description: "Cache configuration",
      updatedAt: "2026-01-02T00:00:00Z",
      updatedBy: "vector",
    });

    seedDoc("tenants/test-user-123/gsp/fleet/entries/fleet-status", {
      key: "fleet-status",
      namespace: "fleet",
      value: { active: 5, description: "fleet auth status" },
      tier: "operational",
      description: "Fleet overview",
      updatedAt: "2026-01-03T00:00:00Z",
      updatedBy: "iso",
    });
  });

  // #44
  it("scores key matches highest (weight 10 for exact)", async () => {
    const result = await gspSearchHandler(mockAuth, { query: "auth-rules" });
    const data = parse(result);

    expect(data.success).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    // First result should be exact key match
    expect(data.results[0].key).toBe("auth-rules");
    expect(data.results[0].score).toBeGreaterThanOrEqual(10);
  });

  // #45
  it("scores description matches (weight 5)", async () => {
    // Seed entry where only description matches
    seedDoc("tenants/test-user-123/gsp/runtime/entries/logging", {
      key: "logging",
      namespace: "runtime",
      value: { level: "info" },
      tier: "operational",
      description: "Logging rules for deployment pipeline",
      updatedAt: "2026-01-04T00:00:00Z",
      updatedBy: "vector",
    });

    const result = await gspSearchHandler(mockAuth, { query: "deployment" });
    const data = parse(result);

    expect(data.results.length).toBeGreaterThan(0);
    const match = data.results.find((r: any) => r.key === "logging");
    expect(match).toBeDefined();
    expect(match.score).toBe(5);
  });

  // #46
  it("scores value matches (weight 3)", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/misc", {
      key: "misc",
      namespace: "runtime",
      value: { data: "contains-the-zebra-token" },
      tier: "operational",
      description: "Miscellaneous config",
      updatedAt: "2026-01-05T00:00:00Z",
      updatedBy: "vector",
    });

    const result = await gspSearchHandler(mockAuth, { query: "zebra" });
    const data = parse(result);

    expect(data.results.length).toBe(1);
    expect(data.results[0].key).toBe("misc");
    expect(data.results[0].score).toBe(3);
  });

  // #47
  it("searches across namespaces when no namespace specified", async () => {
    const result = await gspSearchHandler(mockAuth, { query: "auth" });
    const data = parse(result);

    // Should find results from both runtime and fleet namespaces
    const namespaces = new Set(data.results.map((r: any) => r.namespace));
    expect(namespaces.size).toBeGreaterThan(1);
  });

  // #48
  it("filters by namespace when specified", async () => {
    const result = await gspSearchHandler(mockAuth, { query: "auth", namespace: "runtime" });
    const data = parse(result);

    expect(data.results.length).toBeGreaterThan(0);
    data.results.forEach((r: any) => {
      expect(r.namespace).toBe("runtime");
    });
  });

  // #49
  it("filters by tier", async () => {
    seedDoc("tenants/test-user-123/gsp/runtime/entries/arch-entry", {
      key: "arch-entry",
      namespace: "runtime",
      value: "auth-arch",
      tier: "architectural",
      description: "Architectural auth entry",
      updatedAt: "2026-01-06T00:00:00Z",
      updatedBy: "vector",
    });

    const result = await gspSearchHandler(mockAuth, { query: "auth", tier: "operational" });
    const data = parse(result);

    data.results.forEach((r: any) => {
      expect(r.tier).toBe("operational");
    });
  });

  // #50
  it("searches memory scope", async () => {
    seedDoc("tenants/test-user-123/sessions/_meta/program_state/basher", {
      learnedPatterns: [
        {
          id: "p1",
          domain: "security",
          pattern: "Always validate auth tokens",
          confidence: 0.95,
          evidence: "Prevented bypass",
          discoveredAt: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ],
    });

    const result = await gspSearchHandler(mockAuth, { query: "auth", scope: "memory" });
    const data = parse(result);

    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].source).toBe("memory");
  });

  // #51
  it("searches all scope (gsp + memory)", async () => {
    seedDoc("tenants/test-user-123/sessions/_meta/program_state/basher", {
      learnedPatterns: [
        {
          id: "p1",
          domain: "security",
          pattern: "Always validate auth tokens",
          confidence: 0.95,
          evidence: "Prevented bypass",
          discoveredAt: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ],
    });

    const result = await gspSearchHandler(mockAuth, { query: "auth", scope: "all" });
    const data = parse(result);

    const sources = new Set(data.results.map((r: any) => r.source));
    expect(sources.has("gsp")).toBe(true);
    expect(sources.has("memory")).toBe(true);
  });

  // #52
  it("respects limit", async () => {
    // Seed 30 matching entries
    for (let i = 0; i < 30; i++) {
      seedDoc(`tenants/test-user-123/gsp/runtime/entries/auth-item-${i}`, {
        key: `auth-item-${i}`,
        namespace: "runtime",
        value: `auth-val-${i}`,
        tier: "operational",
        description: "Auth related item",
        updatedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        updatedBy: "vector",
      });
    }

    const result = await gspSearchHandler(mockAuth, { query: "auth", limit: 5 });
    const data = parse(result);

    expect(data.returnedCount).toBe(5);
    expect(data.matchCount).toBeGreaterThan(5);
  });

  // #53
  it("truncates large values in results", async () => {
    const largeValue = "x".repeat(1000);
    seedDoc("tenants/test-user-123/gsp/runtime/entries/big-entry", {
      key: "big-entry",
      namespace: "runtime",
      value: largeValue,
      tier: "operational",
      description: "Big entry",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "vector",
    });

    const result = await gspSearchHandler(mockAuth, { query: "big-entry" });
    const data = parse(result);

    expect(data.results.length).toBeGreaterThan(0);
    const match = data.results.find((r: any) => r.key === "big-entry");
    expect(match).toBeDefined();
    expect(match.valueTruncated).toBe(true);
  });
});
