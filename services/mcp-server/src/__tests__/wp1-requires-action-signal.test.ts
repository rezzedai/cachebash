/**
 * WP-1 — signal.ts creates target:"user" task documents (ask_question's task
 * doc, send_alert's task mirror) via direct Firestore writes that bypass
 * classifyRequiresAction() in dispatch/tasks.ts, and never set requires_action
 * at all. These are mobile-app-visibility artifacts, never claimed by a
 * program's own get_tasks() poll, so WP-1 sets requires_action explicitly to
 * false. This test asserts both writers' task docs carry requires_action ===
 * false.
 *
 * Fails on pre-WP-1 code: neither written task doc has a requires_action key,
 * so `expect(task.requires_action).toBe(false)` fails with "expected false,
 * received undefined".
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import { askQuestionHandler, sendAlertHandler } from "../modules/signal.js";
import type { AuthContext } from "../auth/authValidator.js";

const mockData: Record<string, any> = {};

const mockFirestore = {
  collection: jest.fn((path: string) => ({
    add: jest.fn((data: any) => {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      mockData[`${path}/${id}`] = data;
      return Promise.resolve({ id });
    }),
    doc: jest.fn((id: string) => ({
      set: jest.fn((data: any) => {
        mockData[`${path}/${id}`] = data;
        return Promise.resolve();
      }),
    })),
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockFirestore),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

beforeEach(() => {
  Object.keys(mockData).forEach((k) => delete mockData[k]);
  jest.clearAllMocks();
});

const mockAuth: AuthContext = {
  userId: "test-user",
  programId: "iso",
  keyProgramId: "iso",
  apiKeyHash: "test-hash",
  capabilities: ["dispatch.write"],
  encryptionKey: Buffer.from("test-encryption-key-32-bytes!!!"),
  rateLimitTier: "internal",
};

function findDoc(prefix: string) {
  const entry = Object.entries(mockData).find(([key]) => key.startsWith(prefix));
  if (!entry) throw new Error(`no doc created under ${prefix}`);
  return entry[1];
}

describe("WP-1: signal.ts sets requires_action explicitly on target:user tasks", () => {
  it("ask_question: the written task doc has requires_action === false", async () => {
    await askQuestionHandler(mockAuth, { question: "Proceed?", encrypt: false });

    const task = findDoc("tenants/test-user/tasks/");
    expect(task.target).toBe("user");
    expect(task.requires_action).toBe(false);
  });

  it("send_alert: the task mirror has requires_action === false", async () => {
    await sendAlertHandler(mockAuth, { message: "disk full", alertType: "error" });

    const task = findDoc("tenants/test-user/tasks/");
    expect(task.target).toBe("user");
    expect(task.requires_action).toBe(false);
  });
});
