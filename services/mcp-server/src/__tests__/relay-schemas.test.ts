import { validatePayload, RELAY_PAYLOAD_SCHEMAS } from "../types/relay-schemas";

describe("Relay Payload Schemas", () => {
  describe("RESULT schema", () => {
    it("validates a complete RESULT payload", () => {
      const result = validatePayload("RESULT", {
        taskId: "task-1",
        outcome: "success",
        prUrl: "https://github.com/org/repo/pull/1",
        summary: "All stories completed",
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("validates empty RESULT payload", () => {
      expect(validatePayload("RESULT", {}).valid).toBe(true);
    });

    it("rejects invalid outcome value", () => {
      const result = validatePayload("RESULT", { outcome: "unknown" });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe("DIRECTIVE schema", () => {
    it("validates a complete DIRECTIVE payload", () => {
      const result = validatePayload("DIRECTIVE", {
        action: "deploy",
        priority: "high",
        instructions: "Deploy to production",
        taskId: "task-2",
      });
      expect(result.valid).toBe(true);
    });

    it("validates empty DIRECTIVE payload", () => {
      expect(validatePayload("DIRECTIVE", {}).valid).toBe(true);
    });
  });

  describe("QUERY schema", () => {
    it("validates a QUERY payload", () => {
      const result = validatePayload("QUERY", {
        question: "What is the status?",
        context: "Sprint v2.1",
        responseFormat: "json",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("STATUS schema", () => {
    it("validates a STATUS payload", () => {
      const result = validatePayload("STATUS", {
        state: "working",
        progress: 75,
        currentTask: "Implementing tracing",
      });
      expect(result.valid).toBe(true);
    });

    it("validates STATUS payload with error string", () => {
      const result = validatePayload("STATUS", {
        state: "blocked",
        error: "Network timeout",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("HANDSHAKE schema", () => {
    it("validates a HANDSHAKE payload", () => {
      const result = validatePayload("HANDSHAKE", {
        version: "2.1",
        capabilities: ["relay", "sprint", "trace"],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("ACK schema", () => {
    it("validates an ACK payload", () => {
      const result = validatePayload("ACK", {
        messageId: "msg-123",
        acknowledged: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("PING/PONG schemas", () => {
    it("validates empty PING payload", () => {
      expect(validatePayload("PING", {}).valid).toBe(true);
    });

    it("validates empty PONG payload", () => {
      expect(validatePayload("PONG", {}).valid).toBe(true);
    });
  });

  describe("unknown message type", () => {
    it("returns invalid for unknown type", () => {
      const result = validatePayload("UNKNOWN_TYPE", {});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Unknown message type: UNKNOWN_TYPE");
    });
  });

  describe("all 8 schemas are registered", () => {
    const expectedTypes = ["RESULT", "DIRECTIVE", "QUERY", "STATUS", "HANDSHAKE", "ACK", "PING", "PONG"];

    it.each(expectedTypes)("has schema for %s", (type) => {
      expect(RELAY_PAYLOAD_SCHEMAS[type]).toBeDefined();
    });
  });
});
