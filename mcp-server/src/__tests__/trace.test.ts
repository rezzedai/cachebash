import { extractContext, sanitizeArgs } from "../modules/trace";

describe("Trace Module", () => {
  describe("extractContext", () => {
    it("extracts sprintId from args", () => {
      const ctx = extractContext("update_sprint_story", { sprintId: "sp-1", storyId: "st-1" });
      expect(ctx).toEqual({ sprintId: "sp-1", storyId: "st-1" });
    });

    it("extracts taskId from args", () => {
      const ctx = extractContext("claim_task", { taskId: "task-42" });
      expect(ctx).toEqual({ taskId: "task-42" });
    });

    it("extracts all three context fields", () => {
      const ctx = extractContext("test", { sprintId: "sp-1", taskId: "t-1", storyId: "st-1" });
      expect(ctx).toEqual({ sprintId: "sp-1", taskId: "t-1", storyId: "st-1" });
    });

    it("returns empty object for args without context fields", () => {
      const ctx = extractContext("send_message", { message: "hello", target: "basher" });
      expect(ctx).toEqual({});
    });

    it("ignores non-string values for context fields", () => {
      const ctx = extractContext("test", { sprintId: 123, taskId: null, storyId: undefined });
      expect(ctx).toEqual({});
    });

    it("handles null/undefined args", () => {
      expect(extractContext("test", null)).toEqual({});
      expect(extractContext("test", undefined)).toEqual({});
    });
  });

  describe("sanitizeArgs", () => {
    it("truncates strings over 200 chars", () => {
      const long = "a".repeat(250);
      const result = sanitizeArgs(long) as string;
      expect(result.length).toBe(203); // 200 + "..."
      expect(result.endsWith("...")).toBe(true);
    });

    it("preserves short strings", () => {
      expect(sanitizeArgs("hello")).toBe("hello");
    });

    it("handles nested objects", () => {
      const input = { message: "a".repeat(250), nested: { value: "short" } };
      const result = sanitizeArgs(input) as Record<string, unknown>;
      expect((result.message as string).length).toBe(203);
      expect((result.nested as Record<string, unknown>).value).toBe("short");
    });

    it("handles null and undefined", () => {
      expect(sanitizeArgs(null)).toBeNull();
      expect(sanitizeArgs(undefined)).toBeUndefined();
    });

    it("handles arrays", () => {
      const input = ["short", "a".repeat(250)];
      const result = sanitizeArgs(input) as string[];
      expect(result[0]).toBe("short");
      expect(result[1].length).toBe(203);
    });
  });
});
