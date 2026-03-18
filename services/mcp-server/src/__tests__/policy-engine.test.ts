/**
 * Policy Engine Tests — Dynamic policy rules with scope binding and enforcement.
 */

import type { AuthContext } from "../auth/authValidator.js";
import {
  createPolicy,
  updatePolicy,
  deletePolicy,
  getPolicy,
  listPolicies,
  policyCheck,
  evaluatePolicies,
} from "../modules/policy.js";

// Mock Firebase
jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => ({
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => ({ exists: false, data: () => null })),
      set: jest.fn(async () => {}),
      update: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
    })),
    collection: jest.fn((path: string) => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn(async () => ({ docs: [] })),
          })),
          get: jest.fn(async () => ({ docs: [] })),
        })),
        get: jest.fn(async () => ({ docs: [] })),
      })),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
      get: jest.fn(async () => ({ docs: [] })),
    })),
    runTransaction: jest.fn(async (callback) => {
      const mockTransaction = {
        get: jest.fn(async () => ({ exists: false, data: () => null })),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return callback(mockTransaction);
    }),
  })),
  serverTimestamp: jest.fn(() => ({ _seconds: Date.now() / 1000 })),
}));

// Mock GSP handlers
jest.mock("../modules/gsp.js", () => ({
  gspReadHandler: jest.fn(async (auth: AuthContext, args: any) => {
    // Return mock based on namespace and key
    if (args.namespace === "policies") {
      if (args.key) {
        // Single policy read
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                found: false,
                namespace: args.namespace,
                key: args.key,
              }),
            },
          ],
        };
      } else {
        // List all policies
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                namespace: args.namespace,
                entries: [],
                count: 0,
              }),
            },
          ],
        };
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, found: false }) }],
    };
  }),
  gspWriteHandler: jest.fn(async (auth: AuthContext, args: any) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            namespace: args.namespace,
            key: args.key,
            version: 1,
          }),
        },
      ],
    };
  }),
}));

const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "test-hash-123",
  encryptionKey: Buffer.from("test-key"),
  programId: "iso" as any,
  capabilities: ["policy.read", "policy.write"],
  rateLimitTier: "standard",
};

describe("Policy Engine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Policy CRUD", () => {
    it("should create an operational policy", async () => {
      const result = await createPolicy(mockAuth, {
        id: "test-policy-1",
        name: "Test Policy",
        description: "A test policy",
        tier: "operational",
        enforcement: "warn",
        severity: "P2",
        rule: {
          type: "pattern",
          pattern: "test-pattern",
        },
        scope: {
          programs: [],
        },
        enabled: true,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.policy).toBeDefined();
      expect(data.policy.id).toBe("test-policy-1");
    });

    it("should reject constitutional policy creation", async () => {
      const result = await createPolicy(mockAuth, {
        id: "test-policy-constitutional",
        name: "Constitutional Policy",
        description: "Should be rejected",
        tier: "constitutional",
        enforcement: "block",
        severity: "P0",
        rule: {
          type: "pattern",
          pattern: "test",
        },
        scope: {},
        enabled: true,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Constitutional-tier policies can only be created via gsp_seed");
    });

    it("should reject architectural policy creation", async () => {
      const result = await createPolicy(mockAuth, {
        id: "test-policy-architectural",
        name: "Architectural Policy",
        description: "Should be rejected",
        tier: "architectural",
        enforcement: "block",
        severity: "P1",
        rule: {
          type: "pattern",
          pattern: "test",
        },
        scope: {},
        enabled: true,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("gsp_propose");
    });

    it("should list policies with filters", async () => {
      const result = await listPolicies(mockAuth, {
        tier: "operational",
        enabled: true,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.policies)).toBe(true);
    });
  });

  describe("Pattern Evaluation", () => {
    it("should match pattern rules", async () => {
      // Mock listPolicies to return a pattern policy
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "no-force-push",
                    name: "No Force Push",
                    description: "Block force push operations",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P0",
                    rule: {
                      type: "pattern",
                      pattern: "force[\\s-]*push",
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Please force push to main",
        title: "Deploy",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].policyId).toBe("no-force-push");
      expect(matched[0].enforcement).toBe("block");
    });

    it("should not match when pattern doesn't match", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "no-force-push",
                    name: "No Force Push",
                    description: "Block force push operations",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P0",
                    rule: {
                      type: "pattern",
                      pattern: "force[\\s-]*push",
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Please create a new branch",
        title: "Branch",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(0);
    });
  });

  describe("Threshold Evaluation", () => {
    it("should match threshold rules when value exceeds limit", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "cost-limit",
                    name: "Cost Limit",
                    description: "Block tasks with cost > 10 USD",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P1",
                    rule: {
                      type: "threshold",
                      field: "cost_usd",
                      operator: "gt",
                      value: 10,
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Run expensive operation",
        cost_usd: 15,
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].policyId).toBe("cost-limit");
    });

    it("should not match threshold rules when value is within limit", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "cost-limit",
                    name: "Cost Limit",
                    description: "Block tasks with cost > 10 USD",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P1",
                    rule: {
                      type: "threshold",
                      field: "cost_usd",
                      operator: "gt",
                      value: 10,
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Run cheap operation",
        cost_usd: 5,
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(0);
    });
  });

  describe("Allowlist Evaluation", () => {
    it("should match when value is not in allowlist", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "allowed-targets",
                    name: "Allowed Targets",
                    description: "Only allow dispatch to approved programs",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P1",
                    rule: {
                      type: "allowlist",
                      field_path: "target",
                      values: ["iso", "vector", "basher"],
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Test task",
        target: "unknown-program",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].policyId).toBe("allowed-targets");
    });

    it("should not match when value is in allowlist", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "allowed-targets",
                    name: "Allowed Targets",
                    description: "Only allow dispatch to approved programs",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P1",
                    rule: {
                      type: "allowlist",
                      field_path: "target",
                      values: ["iso", "vector", "basher"],
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Test task",
        target: "iso",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(0);
    });
  });

  describe("Denylist Evaluation", () => {
    it("should match when value is in denylist", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "blocked-actions",
                    name: "Blocked Actions",
                    description: "Block certain action types",
                    tier: "operational",
                    enforcement: "warn",
                    severity: "P2",
                    rule: {
                      type: "denylist",
                      field_path: "action",
                      values: ["interrupt", "sprint"],
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "Test task",
        action: "interrupt",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].policyId).toBe("blocked-actions");
    });
  });

  describe("Scope Filtering", () => {
    it("should only evaluate policies for matching program scope", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "iso-only-policy",
                    name: "ISO Only Policy",
                    description: "Only applies to ISO program",
                    tier: "operational",
                    enforcement: "warn",
                    severity: "P2",
                    rule: {
                      type: "pattern",
                      pattern: "test",
                    },
                    scope: {
                      programs: ["iso"],
                    },
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "test task",
        target: "basher",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(0); // Should not match because scope is ISO only
    });

    it("should evaluate policies when program scope matches", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "iso-only-policy",
                    name: "ISO Only Policy",
                    description: "Only applies to ISO program",
                    tier: "operational",
                    enforcement: "warn",
                    severity: "P2",
                    rule: {
                      type: "pattern",
                      pattern: "test",
                    },
                    scope: {
                      programs: ["iso"],
                    },
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const evaluations = await evaluatePolicies(mockAuth, {
        instructions: "test task",
        target: "iso",
      });

      const matched = evaluations.filter((e) => e.matched);
      expect(matched.length).toBe(1); // Should match because target is ISO
    });
  });

  describe("Policy Check Tool", () => {
    it("should provide dry-run policy check", async () => {
      const { gspReadHandler } = require("../modules/gsp.js");
      (gspReadHandler as jest.Mock).mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              entries: [
                {
                  value: {
                    id: "test-blocker",
                    name: "Test Blocker",
                    description: "Blocks test operations",
                    tier: "operational",
                    enforcement: "block",
                    severity: "P0",
                    rule: {
                      type: "pattern",
                      pattern: "forbidden",
                    },
                    scope: {},
                    enabled: true,
                    createdBy: "test",
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                },
              ],
              count: 1,
            }),
          },
        ],
      });

      const result = await policyCheck(mockAuth, {
        instructions: "This contains forbidden operation",
        target: "iso",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.would_block).toBe(true);
      expect(data.summary.blockers).toBe(1);
    });
  });
});
