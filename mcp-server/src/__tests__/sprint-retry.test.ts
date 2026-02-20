// Mock external dependencies before importing sprint module
jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn(),
}));

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(),
  serverTimestamp: jest.fn(),
}));

import { storyStatusToLifecycle } from "../modules/sprint";

describe("Sprint Retry", () => {
  describe("storyStatusToLifecycle", () => {
    const mappings: [string, string][] = [
      ["queued", "created"],
      ["active", "active"],
      ["complete", "done"],
      ["failed", "failed"],
      ["skipped", "derezzed"],
    ];

    it.each(mappings)("maps %s to %s", (input, expected) => {
      expect(storyStatusToLifecycle(input)).toBe(expected);
    });

    it("maps unknown status to created", () => {
      expect(storyStatusToLifecycle("bogus")).toBe("created");
    });
  });
});
