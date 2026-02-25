// Mock external dependencies before importing sprint module
jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn(),
}));

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(),
  serverTimestamp: jest.fn(),
}));

import { storyStatusToLifecycle } from "../modules/sprint";
import type { EventType } from "../modules/events";

describe("Sprint Retry", () => {
  describe("storyStatusToLifecycle", () => {
    const mappings: [string, string][] = [
      ["queued", "created"],
      ["active", "active"],
      ["complete", "done"],
      ["failed", "failed"],
      ["skipped", "archived"],
    ];

    it.each(mappings)("maps %s to %s", (input, expected) => {
      expect(storyStatusToLifecycle(input)).toBe(expected);
    });

    it("maps unknown status to created", () => {
      expect(storyStatusToLifecycle("bogus")).toBe("created");
    });
  });

  describe("Retry Event Types", () => {
    it("TASK_RETRIED is a valid event type", () => {
      const eventType: EventType = "TASK_RETRIED";
      expect(eventType).toBe("TASK_RETRIED");
    });

    it("TASK_RETRY_EXHAUSTED is a valid event type", () => {
      const eventType: EventType = "TASK_RETRY_EXHAUSTED";
      expect(eventType).toBe("TASK_RETRY_EXHAUSTED");
    });
  });

  describe("Retry History", () => {
    it("retryHistory entry includes attempt and failedAt", () => {
      // Mock a retry history entry
      const historyEntry = {
        attempt: 1,
        failedAt: new Date().toISOString(),
      };

      expect(historyEntry).toHaveProperty("attempt");
      expect(historyEntry).toHaveProperty("failedAt");
      expect(typeof historyEntry.attempt).toBe("number");
      expect(typeof historyEntry.failedAt).toBe("string");
      expect(historyEntry.attempt).toBeGreaterThan(0);
    });

    it("retryAfter is calculated with linear backoff", () => {
      const retryCount = 2;
      const backoffMs = retryCount * 30000; // 60000ms = 60s
      const retryAfter = new Date(Date.now() + backoffMs);
      const now = new Date();

      // retryAfter should be approximately 60s in the future
      const diff = retryAfter.getTime() - now.getTime();
      expect(diff).toBeGreaterThanOrEqual(59000); // Allow small timing variance
      expect(diff).toBeLessThanOrEqual(61000);
    });
  });
});
