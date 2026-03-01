import type { AuthContext } from "../auth/authValidator";
import { checkSessionCompliance, COMPLIANCE_EXEMPT_TOOLS } from "../middleware/sessionCompliance";
import { emitEvent } from "../modules/events";

const sessionDocs = new Map<string, Record<string, any>>();
let throwOnRead = false;

const mockDb = {
  doc: jest.fn((path: string) => ({
    get: jest.fn(async () => {
      if (throwOnRead) throw new Error("read failed");
      const data = sessionDocs.get(path);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
    set: jest.fn(async (data: Record<string, any>, opts?: { merge?: boolean }) => {
      const existing = sessionDocs.get(path) || {};
      sessionDocs.set(path, opts?.merge ? { ...existing, ...data } : data);
    }),
    update: jest.fn(async (data: Record<string, any>) => {
      const existing = sessionDocs.get(path) || {};
      sessionDocs.set(path, { ...existing, ...data });
    }),
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
}));

jest.mock("../modules/events.js", () => ({
  emitEvent: jest.fn(),
}));

function auth(programId: string): AuthContext {
  return {
    userId: "u1",
    apiKeyHash: "k1",
    encryptionKey: Buffer.from("abc"),
    programId: programId as any,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
}

function compliancePath(sessionId: string): string {
  return `tenants/u1/sessions/${sessionId}`;
}

describe("sessionCompliance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionDocs.clear();
    throwOnRead = false;
  });

  it("tracks boot checkpoints and transitions to COMPLIANT regardless of order", async () => {
    const sessionId = "boot-order";
    const a = auth("iso");

    await checkSessionCompliance(a, "get_tasks", {}, { sessionId, endpoint: "mcp" });
    await checkSessionCompliance(a, "get_messages", {}, { sessionId, endpoint: "mcp" });
    await checkSessionCompliance(a, "get_program_state", {}, { sessionId, endpoint: "mcp" });

    const state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.boot.gotProgramState).toBe(true);
    expect(state.boot.gotTasks).toBe(true);
    expect(state.boot.gotMessages).toBe(true);
    expect(state.state).toBe("COMPLIANT");
  });

  it("warns and degrades by threshold, then restores on update_program_state", async () => {
    const sessionId = "journal-thresholds";
    const a = auth("iso");

    await checkSessionCompliance(a, "claim_task", {}, { sessionId, endpoint: "mcp" });
    for (let i = 0; i < 11; i += 1) {
      await checkSessionCompliance(a, "send_message", {}, { sessionId, endpoint: "mcp" });
    }

    let state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.state).toBe("WARNED");

    for (let i = 0; i < 15; i += 1) {
      await checkSessionCompliance(a, "send_message", {}, { sessionId, endpoint: "mcp" });
    }

    state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.state).toBe("DEGRADED");

    await checkSessionCompliance(a, "update_program_state", { programId: "iso" }, { sessionId, endpoint: "mcp" });
    state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.state).toBe("COMPLIANT");
    expect(state.journal.toolCallsSinceLastJournal).toBe(0);
  });

  it("bypasses compliance for exempt programs", async () => {
    const sessionId = "exempt-program";
    const result = await checkSessionCompliance(auth("admin-mirror"), "send_message", {}, { sessionId, endpoint: "mcp" });

    expect(result).toEqual({ allowed: true });
    expect(sessionDocs.get(compliancePath(sessionId))).toBeUndefined();
  });

  it("does not increment journal counters for exempt tools", async () => {
    const sessionId = "exempt-tool";
    const a = auth("basher");

    await checkSessionCompliance(a, "claim_task", {}, { sessionId, endpoint: "mcp" });
    await checkSessionCompliance(a, "send_message", {}, { sessionId, endpoint: "mcp" });
    const before = sessionDocs.get(compliancePath(sessionId))?.compliance.journal.toolCallsSinceLastJournal;

    const exemptTool = Array.from(COMPLIANCE_EXEMPT_TOOLS)[0];
    await checkSessionCompliance(a, exemptTool, {}, { sessionId, endpoint: "mcp" });
    const after = sessionDocs.get(compliancePath(sessionId))?.compliance.journal.toolCallsSinceLastJournal;

    expect(after).toBe(before);
  });

  it("fails open and emits COMPLIANCE_CHECK_FAILED when read throws", async () => {
    const sessionId = "read-failure";
    throwOnRead = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkSessionCompliance(auth("iso"), "send_message", {}, { sessionId, endpoint: "mcp" });

    expect(result).toEqual({ allowed: true });
    expect(errorSpy).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ event_type: "COMPLIANCE_CHECK_FAILED" })
    );
    errorSpy.mockRestore();
  });

  it("blocks calls for DEREZED sessions", async () => {
    const sessionId = "derezed";
    sessionDocs.set(compliancePath(sessionId), {
      compliance: {
        state: "DEREZED",
        boot: { gotProgramState: true, gotTasks: true, gotMessages: true },
        journal: { toolCallsSinceLastJournal: 0, totalToolCalls: 0, journalActivated: true },
        stateChangedAt: new Date().toISOString(),
        stateHistory: [],
      },
    });

    const result = await checkSessionCompliance(auth("iso"), "send_message", {}, { sessionId, endpoint: "mcp" });

    expect(result).toEqual({
      allowed: false,
      reason: "Session is terminated (DEREZED). Start a new session.",
      code: "SESSION_TERMINATED",
    });
  });

  it("does not trigger warnings before claim_task activates journaling", async () => {
    const sessionId = "pre-claim";
    const a = auth("iso");

    for (let i = 0; i < 40; i += 1) {
      await checkSessionCompliance(a, "send_message", {}, { sessionId, endpoint: "mcp" });
    }

    let state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.state).not.toBe("WARNED");
    expect(state.state).not.toBe("DEGRADED");

    await checkSessionCompliance(a, "claim_task", {}, { sessionId, endpoint: "mcp" });
    state = sessionDocs.get(compliancePath(sessionId))?.compliance;
    expect(state.journal.journalActivated).toBe(true);
    expect(state.journal.toolCallsSinceLastJournal).toBe(0);
  });
});
