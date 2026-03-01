/**
 * Trace Propagation L2 — Schema & field propagation tests.
 * Validates that all 5 gaps accept trace fields and that
 * model/provider are required on complete_task.
 */

import { z } from "zod";
import { extractContext } from "../modules/trace";
import { generateSpanId } from "../utils/trace";

// Re-declare schemas locally to test them without importing private module vars.
// This mirrors the actual schemas in dispatch.ts, sprint.ts, programState.ts.

const CompleteTaskSchema = z.object({
  taskId: z.string(),
  tokens_in: z.number().nonnegative().optional(),
  tokens_out: z.number().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  model: z.string(),
  provider: z.string(),
  result: z.string().max(4000).optional(),
  error_code: z.string().optional(),
  error_class: z.enum(["TRANSIENT", "PERMANENT", "DEPENDENCY", "POLICY", "TIMEOUT", "UNKNOWN"]).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const BatchClaimTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(50),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const BatchCompleteTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(50),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  result: z.string().max(4000).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const CreateSprintSchema = z.object({
  projectName: z.string().max(100),
  branch: z.string().max(100),
  stories: z.array(z.object({ id: z.string(), title: z.string() })),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const UpdateStorySchema = z.object({
  sprintId: z.string(),
  storyId: z.string(),
  status: z.enum(["queued", "active", "complete", "failed", "skipped"]).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const AddStorySchema = z.object({
  sprintId: z.string(),
  story: z.object({ id: z.string(), title: z.string() }),
  insertionMode: z.enum(["current_wave", "next_wave", "backlog"]).default("next_wave"),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const UpdateProgramStateSchema = z.object({
  programId: z.string().max(100),
  sessionId: z.string().max(100).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

describe("Trace Propagation L2", () => {
  const traceId = "trace-abc-123";
  const spanId = generateSpanId();
  const parentSpanId = generateSpanId();

  describe("Gap 1 + 5: complete_task — trace fields + model/provider required", () => {
    it("accepts trace fields on complete_task", () => {
      const result = CompleteTaskSchema.parse({
        taskId: "task-1",
        model: "claude-opus-4-6",
        provider: "anthropic",
        traceId,
        spanId,
        parentSpanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
      expect(result.parentSpanId).toBe(parentSpanId);
    });

    it("requires model field", () => {
      expect(() =>
        CompleteTaskSchema.parse({
          taskId: "task-1",
          provider: "anthropic",
        })
      ).toThrow();
    });

    it("requires provider field", () => {
      expect(() =>
        CompleteTaskSchema.parse({
          taskId: "task-1",
          model: "claude-opus-4-6",
        })
      ).toThrow();
    });

    it("rejects missing both model and provider", () => {
      expect(() =>
        CompleteTaskSchema.parse({
          taskId: "task-1",
        })
      ).toThrow();
    });

    it("trace fields are optional", () => {
      const result = CompleteTaskSchema.parse({
        taskId: "task-1",
        model: "claude-opus-4-6",
        provider: "anthropic",
      });
      expect(result.traceId).toBeUndefined();
      expect(result.spanId).toBeUndefined();
    });
  });

  describe("Gap 2: Sprint operations — trace propagation", () => {
    it("create_sprint accepts trace context", () => {
      const result = CreateSprintSchema.parse({
        projectName: "test-project",
        branch: "main",
        stories: [{ id: "s1", title: "Story 1" }],
        traceId,
        spanId,
        parentSpanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
      expect(result.parentSpanId).toBe(parentSpanId);
    });

    it("update_sprint_story accepts trace context", () => {
      const result = UpdateStorySchema.parse({
        sprintId: "sprint-1",
        storyId: "story-1",
        status: "active",
        traceId,
        spanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
    });

    it("add_story_to_sprint accepts trace context", () => {
      const result = AddStorySchema.parse({
        sprintId: "sprint-1",
        story: { id: "s2", title: "Story 2" },
        traceId,
        parentSpanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.parentSpanId).toBe(parentSpanId);
    });

    it("sprint trace fields are optional", () => {
      const result = CreateSprintSchema.parse({
        projectName: "test",
        branch: "main",
        stories: [{ id: "s1", title: "Story 1" }],
      });
      expect(result.traceId).toBeUndefined();
    });
  });

  describe("Gap 3: Batch operations — trace propagation", () => {
    it("batch_claim_tasks accepts trace context", () => {
      const result = BatchClaimTasksSchema.parse({
        taskIds: ["task-1", "task-2"],
        sessionId: "test-session",
        traceId,
        spanId,
        parentSpanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
      expect(result.parentSpanId).toBe(parentSpanId);
    });

    it("batch_complete_tasks accepts trace context", () => {
      const result = BatchCompleteTasksSchema.parse({
        taskIds: ["task-1"],
        completed_status: "SUCCESS",
        traceId,
        spanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
    });

    it("batch trace fields are optional", () => {
      const result = BatchClaimTasksSchema.parse({
        taskIds: ["task-1"],
      });
      expect(result.traceId).toBeUndefined();
    });
  });

  describe("Gap 4: Program state — trace propagation", () => {
    it("update_program_state accepts trace context", () => {
      const result = UpdateProgramStateSchema.parse({
        programId: "basher",
        sessionId: "session-1",
        traceId,
        spanId,
        parentSpanId,
      });
      expect(result.traceId).toBe(traceId);
      expect(result.spanId).toBe(spanId);
      expect(result.parentSpanId).toBe(parentSpanId);
    });

    it("program state trace fields are optional", () => {
      const result = UpdateProgramStateSchema.parse({
        programId: "basher",
      });
      expect(result.traceId).toBeUndefined();
    });
  });

  describe("extractContext includes trace fields", () => {
    it("extracts traceId/spanId/parentSpanId from args", () => {
      const ctx = extractContext("complete_task", {
        taskId: "task-1",
        traceId,
        spanId,
        parentSpanId,
      });
      expect(ctx.traceId).toBe(traceId);
      expect(ctx.spanId).toBe(spanId);
      expect(ctx.parentSpanId).toBe(parentSpanId);
      expect(ctx.taskId).toBe("task-1");
    });

    it("extracts trace fields alongside sprint context", () => {
      const ctx = extractContext("update_sprint_story", {
        sprintId: "sp-1",
        storyId: "st-1",
        traceId,
        spanId,
      });
      expect(ctx.sprintId).toBe("sp-1");
      expect(ctx.storyId).toBe("st-1");
      expect(ctx.traceId).toBe(traceId);
      expect(ctx.spanId).toBe(spanId);
    });
  });

  describe("generateSpanId", () => {
    it("returns a valid UUID v7 format", () => {
      const id = generateSpanId();
      // UUID format: 8-4-4-4-12
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
      expect(ids.size).toBe(100);
    });
  });
});
