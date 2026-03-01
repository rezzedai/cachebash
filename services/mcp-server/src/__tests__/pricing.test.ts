import type { AuthContext } from "../auth/authValidator";
import { checkPricing } from "../middleware/pricingEnforce";

// Mock Firestore documents
const firestoreDocs = new Map<string, Record<string, any>>();
let throwOnRead = false;

const mockCollection = jest.fn((name: string) => ({
  doc: jest.fn((docId: string) => ({
    get: jest.fn(async () => {
      if (throwOnRead) throw new Error("read failed");
      const path = `${name}/${docId}`;
      const data = firestoreDocs.get(path);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
    collection: jest.fn((subName: string) => ({
      doc: jest.fn((subDocId: string) => ({
        get: jest.fn(async () => {
          if (throwOnRead) throw new Error("read failed");
          const fullPath = `${name}/${docId}/${subName}/${subDocId}`;
          const data = firestoreDocs.get(fullPath);
          return {
            exists: !!data,
            data: () => data,
          };
        }),
      })),
    })),
  })),
}));

const mockDb = {
  doc: jest.fn((path: string) => ({
    get: jest.fn(async () => {
      if (throwOnRead) throw new Error("read failed");
      const data = firestoreDocs.get(path);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
  })),
  collection: mockCollection,
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

function auth(userId = "u1"): AuthContext {
  return {
    userId,
    apiKeyHash: "k1",
    encryptionKey: Buffer.from("abc"),
    programId: "test-program" as any,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

describe("pricingEnforce", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firestoreDocs.clear();
    throwOnRead = false;
  });

  it("blocks free tier at 100% tasks_created", async () => {
    const userId = "user-free-100";
    firestoreDocs.set(`tenants/${userId}/config/billing`, { tier: "free" });
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 500,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(false);
    expect("reason" in result && result.reason).toContain("Monthly limit reached");
  });

  it("allows pro tier with no warnings (infinity limit)", async () => {
    const userId = "user-pro-unlimited";
    firestoreDocs.set(`tenants/${userId}/config/billing`, { tier: "pro" });
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 10000,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warning).toBeUndefined();
    }
  });

  it("allows team tier with no warnings (infinity limit)", async () => {
    const userId = "user-team-unlimited";
    firestoreDocs.set(`tenants/${userId}/config/billing`, { tier: "team" });
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 10000,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warning).toBeUndefined();
    }
  });

  it("returns 80% warning", async () => {
    const userId = "user-free-80";
    firestoreDocs.set(`tenants/${userId}/config/billing`, { tier: "free" });
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 400,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warning).toContain("80%");
    }
  });

  it("returns 95% warning", async () => {
    const userId = "user-free-95";
    firestoreDocs.set(`tenants/${userId}/config/billing`, { tier: "free" });
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 480,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warning).toContain("95%");
    }
  });

  it("bypasses pricing for read operations", async () => {
    const userId = "user-read-only";
    const result = await checkPricing(auth(userId), "get_tasks");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warning).toBeUndefined();
    }
  });

  it("fails open when Firestore throws", async () => {
    const userId = "user-error";
    throwOnRead = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("uses default free config for new tenants without billing doc", async () => {
    const userId = "user-new-tenant";
    firestoreDocs.set(`tenants/${userId}/usage/${getCurrentPeriod()}`, {
      tasks_created: 500,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0
    });

    const result = await checkPricing(auth(userId), "create_task");
    expect(result.allowed).toBe(false);
    expect("reason" in result && result.reason).toContain("Monthly limit reached");
  });
});
