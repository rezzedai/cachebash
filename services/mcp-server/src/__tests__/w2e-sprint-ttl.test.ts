/**
 * PLAN-W2e re-census — sprint.ts had three field-less task writers: the
 * escalation-failure fallback task, create_sprint's sprint doc, create_sprint's
 * sprint-story docs, and add_story_to_sprint's dynamically-added story. All are
 * open work with no natural expiry, matching expiresAtBackfillClassifier.ts's
 * "everything else -> sentinel" branch.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("../modules/analytics.js", () => ({ emitAnalyticsEvent: jest.fn() }));
jest.mock("../modules/github-sync.js", () => ({
  syncSprintCreated: jest.fn(),
  syncSprintCompleted: jest.fn(),
  syncStoryUpdated: jest.fn(),
}));

import { createSprintHandler, addStoryHandler, updateStoryHandler } from "../modules/sprint.js";
import type { AuthContext } from "../auth/authValidator.js";
import { CONSTANTS } from "../config/constants.js";

const mockData: Record<string, any> = {};
const batchOps: Array<{ ref: { id: string }; data: any }> = [];

// Story fixture for updateStoryHandler's escalation path (retry.policy: "escalate").
const escalatingStoryData = {
  type: "sprint-story",
  title: "flaky-story",
  sprint: { parentId: "sprint-1" },
  retry: { policy: "escalate", maxRetries: 1, retryCount: 0, retryHistory: [] },
};
const escalatingStoryRef = { update: jest.fn(() => Promise.resolve()) };

const mockFirestore = {
  collection: jest.fn((path: string) => ({
    add: jest.fn((data: any) => {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      mockData[`${path}/${id}`] = data;
      return Promise.resolve({ id });
    }),
    doc: jest.fn(() => {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return {
        id,
        set: jest.fn((data: any) => {
          mockData[`${path}/${id}`] = data;
          return Promise.resolve();
        }),
      };
    }),
    where: jest.fn().mockReturnThis(),
    get: jest.fn(() =>
      Promise.resolve({
        docs: [{ id: "story-1", data: () => escalatingStoryData, ref: escalatingStoryRef }],
      })
    ),
  })),
  batch: jest.fn(() => ({
    set: jest.fn((ref: any, data: any) => batchOps.push({ ref, data })),
    commit: jest.fn(() => {
      for (const op of batchOps) mockData[`tenants/test-user/tasks/${op.ref.id}`] = op.data;
      return Promise.resolve();
    }),
  })),
};

jest.mock("../modules/relay.js", () => ({
  sendMessageHandler: jest.fn(() => {
    throw new Error("relay unavailable (simulated)");
  }),
}));

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockFirestore),
  serverTimestamp: jest.fn(() => "mock-ts"),
}));

beforeEach(() => {
  Object.keys(mockData).forEach((k) => delete mockData[k]);
  batchOps.length = 0;
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

function docsOfType(type: string) {
  return Object.values(mockData).filter((d: any) => d.type === type);
}

const sentinelMs = new Date(CONSTANTS.ttl.neverExpiresSentinel).getTime();

describe("PLAN-W2e: sprint.ts field-less writers", () => {
  it("create_sprint: the sprint doc and every sprint-story doc get the never-expires sentinel", async () => {
    await createSprintHandler(mockAuth, {
      projectName: "proj",
      branch: "main",
      stories: [{ id: "s1", title: "Story one", retryPolicy: "none", maxRetries: 1 }],
    });

    const [sprint] = docsOfType("sprint");
    const [story] = docsOfType("sprint-story");
    expect(sprint.ttl).toBe(0);
    expect(sprint.expiresAt.toDate().getTime()).toBe(sentinelMs);
    expect(story.ttl).toBe(0);
    expect(story.expiresAt.toDate().getTime()).toBe(sentinelMs);
  });

  it("add_story_to_sprint: the dynamically-added story gets the sentinel too", async () => {
    await addStoryHandler(mockAuth, {
      sprintId: "sprint-1",
      story: { id: "s2", title: "Added story", retryPolicy: "none", maxRetries: 1 },
    });

    const [story] = docsOfType("sprint-story");
    expect(story.ttl).toBe(0);
    expect(story.expiresAt.toDate().getTime()).toBe(sentinelMs);
  });

  it("update_story escalation fallback: when the relay escalation itself fails, the fallback alert task still gets the sentinel", async () => {
    await updateStoryHandler(mockAuth, { sprintId: "sprint-1", storyId: "story-1", status: "failed" });

    const [fallbackTask] = docsOfType("task");
    expect(fallbackTask).toBeDefined();
    expect(fallbackTask.title).toContain("ESCALATION FAILED");
    expect(fallbackTask.ttl).toBe(0);
    expect(fallbackTask.expiresAt.toDate().getTime()).toBe(sentinelMs);
  });
});
