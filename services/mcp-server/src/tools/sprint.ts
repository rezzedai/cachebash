/**
 * Sprint Domain Registry — Sprint execution and story tracking tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { createSprintHandler, updateStoryHandler, addStoryHandler, completeSprintHandler, getSprintHandler } from "../modules/sprint.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  create_sprint: createSprintHandler,
  update_sprint_story: updateStoryHandler,
  add_story_to_sprint: addStoryHandler,
  complete_sprint: completeSprintHandler,
  get_sprint: getSprintHandler,
};

export const definitions = [
  {
    name: "create_sprint",
    description: "Create a new sprint to track parallel story execution",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectName: { type: "string", maxLength: 100 },
        branch: { type: "string", maxLength: 100 },
        stories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              wave: { type: "number" },
              dependencies: { type: "array", items: { type: "string" } },
              complexity: { type: "string", enum: ["normal", "high"] },
              retryPolicy: { type: "string", enum: ["none", "auto_retry", "escalate"], default: "none" },
              maxRetries: { type: "number", minimum: 0, maximum: 5, default: 1 },
            },
            required: ["id", "title"],
          },
        },
        sessionId: { type: "string" },
        config: {
          type: "object",
          properties: {
            orchestratorModel: { type: "string" },
            subagentModel: { type: "string" },
            maxConcurrent: { type: "number" },
          },
        },
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["projectName", "branch", "stories"],
    },
  },
  {
    name: "update_sprint_story",
    description: "Update a story's progress within a sprint",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        storyId: { type: "string" },
        status: { type: "string", enum: ["queued", "active", "complete", "failed", "skipped"] },
        progress: { type: "number", minimum: 0, maximum: 100 },
        currentAction: { type: "string", maxLength: 200 },
        model: { type: "string" },
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["sprintId", "storyId"],
    },
  },
  {
    name: "add_story_to_sprint",
    description: "Add a new story to a running sprint",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        story: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            dependencies: { type: "array", items: { type: "string" } },
            complexity: { type: "string", enum: ["normal", "high"] },
          },
          required: ["id", "title"],
        },
        insertionMode: { type: "string", enum: ["current_wave", "next_wave", "backlog"], default: "next_wave" },
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["sprintId", "story"],
    },
  },
  {
    name: "complete_sprint",
    description: "Mark a sprint as complete",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string" },
        summary: {
          type: "object",
          properties: {
            completed: { type: "number" },
            failed: { type: "number" },
            skipped: { type: "number" },
            duration: { type: "number" },
          },
        },
      },
      required: ["sprintId"],
    },
  },
  {
    name: "get_sprint",
    description: "Get a sprint's full state including definition, stories, and stats. Any authenticated program can read.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sprintId: { type: "string", description: "The sprint ID to fetch" },
      },
      required: ["sprintId"],
    },
  },
];
