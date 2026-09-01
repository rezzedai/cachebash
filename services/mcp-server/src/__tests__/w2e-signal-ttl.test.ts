/**
 * PLAN-W2e — signal.ts has TWO field-less task writers.
 *
 * ISO's W2c census (PR #407) classified signal.ts as a "separate, well-scoped
 * subsystem, not part of this family" and that call was wrong: the family is
 * defined by the defect shape (any write into a tasks collection with no
 * expiresAt), not by module boundary. ask_question's task write and send_alert's
 * task mirror both had none.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import { askQuestionHandler, sendAlertHandler } from "../modules/signal.js";
import type { AuthContext } from "../auth/authValidator.js";
import { CONSTANTS } from "../config/constants.js";

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

describe("PLAN-W2e: signal.ts field-less writers", () => {
  it("ask_question: task doc gets the never-expires sentinel — a question awaiting a human answer must never silently expire", async () => {
    await askQuestionHandler(mockAuth, { question: "Proceed?", encrypt: false });

    const task = findDoc("tenants/test-user/tasks/");
    expect(task.ttl).toBe(0);
    expect(task.expiresAt.toDate().getTime()).toBe(
      new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime()
    );
  });

  it("send_alert: the task mirror's expiresAt matches the relay record's exactly — mirror tracks its relay half, not field-less", async () => {
    await sendAlertHandler(mockAuth, { message: "disk full", alertType: "error" });

    const relay = findDoc("tenants/test-user/relay/");
    const task = findDoc("tenants/test-user/tasks/");
    expect(task.ttl).toBe(3600);
    expect(task.expiresAt.toMillis()).toBe(relay.expiresAt.toMillis());
    const in2Hours = Date.now() + 2 * 3600 * 1000;
    expect(task.expiresAt.toMillis()).toBeLessThan(in2Hours);
  });
});
