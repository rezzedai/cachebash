/**
 * complete_task ownership gate (SARK C3/CRITICAL, 2026-03-18).
 *
 * completeTaskHandler had no authorization check — any program key could mark
 * any task done/failed. This suite proves the gate added in this PR is correct.
 *
 * Authorized callers: task claimedBy owner, matching session, "iso",
 * "orchestrator", "legacy", "dispatcher".
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

const mockTx = { get: jest.fn(), update: jest.fn() };
const mockCollection = { add: jest.fn(() => Promise.resolve()) };

// Flexible doc mock: compliance + billing docs return { exists: false } (defaults to lenient/no-budget);
// the task ref is handled via mockTx.get inside the transaction.
const mockDoc = jest.fn(() => ({
  path: "tenants/u1/tasks/t1",
  get: jest.fn(() => Promise.resolve({ exists: false })),
}));

const mockDb = {
  doc: mockDoc,
  runTransaction: jest.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  collection: jest.fn(() => mockCollection),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));
jest.mock("../modules/events.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({ syncTaskCompleted: jest.fn() }));

import { completeTaskHandler } from "../modules/dispatch/completion.js";
import type { AuthContext } from "../auth/authValidator.js";

const ENC = Buffer.from("test-encryption-key-32-bytes-long!!!");

function auth(programId: string): AuthContext {
  return { userId: "u1", programId, apiKeyHash: "h", encryptionKey: ENC, capabilities: ["*"], rateLimitTier: "internal" } as AuthContext;
}

function taskDoc(claimedBy: string | null) {
  const data = () => ({
    status: "active",
    claimedBy,
    sessionId: claimedBy ?? null,
    policy_mode: null,
    stateTransitions: [],
    title: "test",
    type: "task",
    priority: "normal",
  });
  mockTx.get.mockResolvedValue({ exists: true, data });
  mockDoc.mockReturnValue({ path: "tenants/u1/tasks/t1", get: jest.fn(() => Promise.resolve({ exists: false })) });
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const ARGS = { taskId: "t1", completed_status: "SUCCESS" as const, result: "done", model: "sonnet", provider: "anthropic" };

beforeEach(() => { jest.clearAllMocks(); });

describe("complete_task authorization gate (SARK C3)", () => {
  it("REJECTS a non-owner non-admin key completing another program's task", async () => {
    taskDoc("quorra"); // quorra claimed it
    const res = parse(await completeTaskHandler(auth("basher"), ARGS) as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unauthorized/);
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("ALLOWS the claiming owner to complete its own task", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("basher"), ARGS) as never);
    expect(res.success).toBe(true);
  });

  it("ALLOWS iso to complete any task", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("iso"), ARGS) as never);
    expect(res.success).toBe(true);
  });

  it("ALLOWS orchestrator (iso alias) to complete any task", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("orchestrator"), ARGS) as never);
    expect(res.success).toBe(true);
  });

  it("ALLOWS dispatcher (admin) to complete any task", async () => {
    taskDoc("basher");
    const res = parse(await completeTaskHandler(auth("dispatcher"), ARGS) as never);
    expect(res.success).toBe(true);
  });

  it("REJECTS an unrelated program even if task is unclaimed", async () => {
    taskDoc(null); // nobody claimed it
    const res = parse(await completeTaskHandler(auth("basher"), ARGS) as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unauthorized/);
  });
});
