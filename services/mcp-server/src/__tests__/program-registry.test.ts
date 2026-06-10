/**
 * E-2: Dynamic PROGRAM_GROUPS — resolveGroupAsync unit tests
 */

import type { AuthContext } from "../auth/authValidator";

// ---- Firestore mock --------------------------------------------------------

type MockDoc = { id: string; data: () => Record<string, unknown> };

let mockGroupDocs: MockDoc[] = [];
let mockGroupQueryError: Error | null = null;
let mockQueryCalls = 0;

const mockFirestoreInstance = {
  collection: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    get: jest.fn(async () => {
      mockQueryCalls++;
      if (mockGroupQueryError) throw mockGroupQueryError;
      return { docs: mockGroupDocs };
    }),
  })),
  doc: jest.fn(() => ({
    get: jest.fn(async () => ({ exists: false })),
    set: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
  })),
  batch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn(async () => {}) })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockFirestoreInstance),
  serverTimestamp: jest.fn(() => "MOCK_TS"),
}));

// ---- programs config mock --------------------------------------------------

const MOCK_PROGRAM_GROUPS: Record<string, string[]> = {
  council: ["orchestrator", "architect", "reviewer"],
  builders: ["builder", "basher"],
  all: ["orchestrator", "architect", "builder", "basher"],
};

jest.mock("../config/programs.js", () => ({
  REGISTERED_PROGRAMS: ["orchestrator", "architect", "builder", "basher"],
  SPECIAL_PROGRAMS: ["iso", "legacy"],
  PROGRAM_GROUPS: {
    council: ["orchestrator", "architect", "reviewer"],
    builders: ["builder", "basher"],
    all: ["orchestrator", "architect", "builder", "basher"],
  },
  PROGRAM_REGISTRY: {},
  isGroupTarget: jest.fn((t: string) => t in MOCK_PROGRAM_GROUPS),
  isRegisteredProgram: jest.fn(() => false),
  isValidProgram: jest.fn(() => false),
}));

// ---- gate mock -------------------------------------------------------------

jest.mock("../middleware/gate.js", () => ({
  verifySource: jest.fn((s: string) => s),
  isAdmin: jest.fn(() => false),
  logAudit: jest.fn(),
  generateCorrelationId: jest.fn(() => "corr-id"),
}));

// ---- Import after mocks ----------------------------------------------------

// Dynamic import lets jest replace the module cache between describe blocks
// by isolating the module. We re-import in beforeAll so cache state resets.
let resolveGroupAsync: (userId: string, groupName: string) => Promise<string[]>;
let resolveTargetsAsync: (userId: string, target: string) => Promise<string[]>;
let listGroupsAsync: (userId: string) => Promise<Record<string, string[]>>;

beforeAll(async () => {
  // Isolate module so each test suite starts with a fresh cache
  jest.resetModules();
  // Re-apply mocks after reset
  jest.mock("../firebase/client.js", () => ({
    getFirestore: jest.fn(() => mockFirestoreInstance),
    serverTimestamp: jest.fn(() => "MOCK_TS"),
  }));
  jest.mock("../config/programs.js", () => ({
    REGISTERED_PROGRAMS: ["orchestrator", "architect", "builder", "basher"],
    SPECIAL_PROGRAMS: ["iso", "legacy"],
    PROGRAM_GROUPS: {
      council: ["orchestrator", "architect", "reviewer"],
      builders: ["builder", "basher"],
      all: ["orchestrator", "architect", "builder", "basher"],
    },
    PROGRAM_REGISTRY: {},
    isGroupTarget: jest.fn((t: string) => t in MOCK_PROGRAM_GROUPS),
    isRegisteredProgram: jest.fn(() => false),
    isValidProgram: jest.fn(() => false),
  }));
  jest.mock("../middleware/gate.js", () => ({
    verifySource: jest.fn((s: string) => s),
    isAdmin: jest.fn(() => false),
    logAudit: jest.fn(),
    generateCorrelationId: jest.fn(() => "corr-id"),
  }));

  const mod = await import("../modules/programRegistry.js");
  resolveGroupAsync = mod.resolveGroupAsync;
  resolveTargetsAsync = mod.resolveTargetsAsync;
  listGroupsAsync = mod.listGroupsAsync;
});

beforeEach(() => {
  mockGroupDocs = [];
  mockGroupQueryError = null;
  mockQueryCalls = 0;
  jest.clearAllMocks();
  // Reset mock implementations after clearAllMocks
  (mockFirestoreInstance.collection as jest.Mock).mockReturnValue({
    where: jest.fn().mockReturnThis(),
    get: jest.fn(async () => {
      mockQueryCalls++;
      if (mockGroupQueryError) throw mockGroupQueryError;
      return { docs: mockGroupDocs };
    }),
  });
});

describe("E-2: resolveGroupAsync", () => {
  it("returns Firestore results when programs exist for the group", async () => {
    mockGroupDocs = [
      { id: "orchestrator", data: () => ({ active: true, groups: ["council"] }) },
      { id: "architect", data: () => ({ active: true, groups: ["council"] }) },
      { id: "new-reviewer", data: () => ({ active: true, groups: ["council"] }) },
    ];

    const members = await resolveGroupAsync("uid-1", "council");

    expect(members.sort()).toEqual(["architect", "new-reviewer", "orchestrator"]);
    expect(mockQueryCalls).toBe(1);
  });

  it("falls back to PROGRAM_GROUPS when Firestore returns empty", async () => {
    mockGroupDocs = []; // Firestore empty = unseeded tenant

    const members = await resolveGroupAsync("uid-empty", "builders");

    // Should fall back to hardcoded PROGRAM_GROUPS["builders"]
    expect(members.sort()).toEqual(["basher", "builder"]);
  });

  it("falls back to PROGRAM_GROUPS when Firestore throws", async () => {
    mockGroupQueryError = new Error("Firestore unavailable");

    const members = await resolveGroupAsync("uid-error", "council");

    // Falls back gracefully
    expect(members.sort()).toEqual(["architect", "orchestrator", "reviewer"]);
    expect(mockQueryCalls).toBe(1);
  });

  it("returns empty array for unknown group with no Firestore results", async () => {
    mockGroupDocs = [];

    const members = await resolveGroupAsync("uid-unknown", "nonexistent-group");

    expect(members).toEqual([]);
  });

  it("E-2: 60s cache — second call skips Firestore", async () => {
    const userId = "uid-cache-test";
    mockGroupDocs = [
      { id: "basher", data: () => ({ active: true, groups: ["builders"] }) },
    ];

    const first = await resolveGroupAsync(userId, "builders");
    expect(mockQueryCalls).toBe(1);

    // Second call within 60s — should hit cache
    const callsBefore = mockQueryCalls;
    const second = await resolveGroupAsync(userId, "builders");
    expect(mockQueryCalls).toBe(callsBefore); // no extra Firestore call
    expect(second).toEqual(first);
  });
});

describe("E-2: resolveTargetsAsync — group dispatch", () => {
  it("resolves named group via Firestore (not hardcoded)", async () => {
    mockGroupDocs = [
      { id: "orchestrator", data: () => ({ active: true, groups: ["council"] }) },
      { id: "newprogram", data: () => ({ active: true, groups: ["council"] }) },
    ];

    const targets = await resolveTargetsAsync("uid-2", "council");

    // newprogram is NOT in hardcoded PROGRAM_GROUPS["council"] — proves Firestore path
    expect(targets).toContain("newprogram");
    expect(targets).toContain("orchestrator");
  });

  it("resolves single program as-is (not a group)", async () => {
    const targets = await resolveTargetsAsync("uid-3", "basher");

    expect(targets).toEqual(["basher"]);
    expect(mockQueryCalls).toBe(0); // No Firestore call for non-group targets
  });
});

describe("E-2: listGroupsAsync", () => {
  it("returns all group names with their Firestore-resolved members", async () => {
    mockGroupDocs = [
      { id: "orchestrator", data: () => ({}) },
      { id: "architect", data: () => ({}) },
    ];

    const groups = await listGroupsAsync("uid-4");

    // All PROGRAM_GROUPS keys should be present
    expect(Object.keys(groups).sort()).toEqual(["all", "builders", "council"]);
  });
});
