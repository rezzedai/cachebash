/**
 * OpenAPI Spec Generation Tests
 */

// Mock the tools module to avoid ESM import issues in Jest
jest.mock("../tools/index.js", () => ({
  TOOL_DEFINITIONS: [
    {
      name: "dispatch_get_tasks",
      description: "Get tasks created for programs to work on.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["created", "active", "all"], default: "created" },
          type: { type: "string", enum: ["task", "question", "all"], default: "all" },
          limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
    {
      name: "dispatch_create_task",
      description: "Create a new task for a program to work on",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          target: { type: "string", maxLength: 100 },
          instructions: { type: "string", maxLength: 32000 },
        },
        required: ["title", "target"],
      },
    },
    {
      name: "dispatch_get_task_by_id",
      description: "Get a single task by ID",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "relay_send_message",
      description: "Send a message to a program",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          content: { type: "string" },
        },
        required: ["target", "content"],
      },
    },
    {
      name: "pulse_create_session",
      description: "Create a new session",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          programId: { type: "string" },
        },
        required: ["name", "programId"],
      },
    },
  ],
}));

// Mock tool aliases
jest.mock("../tools/tool-aliases.js", () => ({
  getToolAlias: (canonicalName: string) => {
    const aliases: Record<string, string> = {
      dispatch_get_tasks: "get_tasks",
      dispatch_create_task: "create_task",
      dispatch_get_task_by_id: "get_task_by_id",
      relay_send_message: "send_message",
      pulse_create_session: "create_session",
    };
    return aliases[canonicalName];
  },
  resolveToolAlias: (name: string) => name,
}));

import { generateOpenApiSpec } from "../modules/openapi.js";

describe("OpenAPI Spec Generator", () => {
  it("should generate valid OpenAPI 3.0 structure", () => {
    const spec = generateOpenApiSpec();

    // Verify OpenAPI version
    expect(spec.openapi).toBe("3.0.0");

    // Verify info section
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe("CacheBash API");
    expect(spec.info.version).toBeDefined();
    expect(spec.info.description).toBeDefined();

    // Verify servers
    expect(spec.servers).toBeDefined();
    expect(Array.isArray(spec.servers)).toBe(true);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.servers[0].url).toBe("https://api.cachebash.dev");

    // Verify paths
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe("object");

    // Verify components
    expect(spec.components).toBeDefined();
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.schemas).toBeDefined();

    // Verify security
    expect(spec.security).toBeDefined();
    expect(Array.isArray(spec.security)).toBe(true);
  });

  it("should define Bearer auth security scheme", () => {
    const spec = generateOpenApiSpec();

    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");

    // Verify security is applied globally
    expect(spec.security).toContainEqual({ bearerAuth: [] });
  });

  it("should include registered tools as paths", () => {
    const spec = generateOpenApiSpec();
    const pathCount = Object.keys(spec.paths).length;

    // Should have at least some paths from tool definitions
    expect(pathCount).toBeGreaterThan(0);

    // Verify some key endpoints exist
    expect(spec.paths["/v1/tasks"]).toBeDefined();
    expect(spec.paths["/v1/messages"]).toBeDefined();
    expect(spec.paths["/v1/sessions"]).toBeDefined();
  });

  it("should map GET endpoints with query parameters", () => {
    const spec = generateOpenApiSpec();

    // Check GET /v1/tasks (get_tasks tool)
    const getTasksOp = spec.paths["/v1/tasks"]?.get;
    expect(getTasksOp).toBeDefined();
    expect(getTasksOp.parameters).toBeDefined();

    // Should have query parameters like status, limit
    const paramNames = getTasksOp.parameters.map((p: any) => p.name);
    expect(paramNames).toContain("status");
    expect(paramNames).toContain("limit");
  });

  it("should map POST endpoints with request body", () => {
    const spec = generateOpenApiSpec();

    // Check POST /v1/tasks (create_task tool)
    const createTaskOp = spec.paths["/v1/tasks"]?.post;
    expect(createTaskOp).toBeDefined();
    expect(createTaskOp.requestBody).toBeDefined();
    expect(createTaskOp.requestBody.content["application/json"]).toBeDefined();
    expect(createTaskOp.requestBody.content["application/json"].schema).toBeDefined();

    // Verify schema has required fields
    const schema = createTaskOp.requestBody.content["application/json"].schema;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.target).toBeDefined();
  });

  it("should handle path parameters correctly", () => {
    const spec = generateOpenApiSpec();

    // Check GET /v1/tasks/{id} (get_task_by_id tool)
    const getTaskByIdOp = spec.paths["/v1/tasks/{id}"]?.get;
    expect(getTaskByIdOp).toBeDefined();
    expect(getTaskByIdOp.parameters).toBeDefined();

    // Should have 'id' as path parameter
    const pathParam = getTaskByIdOp.parameters.find((p: any) => p.name === "id" && p.in === "path");
    expect(pathParam).toBeDefined();
    expect(pathParam.required).toBe(true);
  });

  it("should include standard responses", () => {
    const spec = generateOpenApiSpec();

    // Check any operation
    const getTasksOp = spec.paths["/v1/tasks"]?.get;
    expect(getTasksOp.responses).toBeDefined();

    // Should have standard HTTP status codes
    expect(getTasksOp.responses["200"]).toBeDefined();
    expect(getTasksOp.responses["400"]).toBeDefined();
    expect(getTasksOp.responses["401"]).toBeDefined();
    expect(getTasksOp.responses["403"]).toBeDefined();
    expect(getTasksOp.responses["429"]).toBeDefined();
    expect(getTasksOp.responses["500"]).toBeDefined();

    // 200 response should have content
    expect(getTasksOp.responses["200"].content).toBeDefined();
    expect(getTasksOp.responses["200"].content["application/json"]).toBeDefined();
  });

  it("should include operation IDs and tags", () => {
    const spec = generateOpenApiSpec();

    // Check an operation
    const getTasksOp = spec.paths["/v1/tasks"]?.get;
    expect(getTasksOp.operationId).toBeDefined();
    expect(getTasksOp.tags).toBeDefined();
    expect(Array.isArray(getTasksOp.tags)).toBe(true);
    expect(getTasksOp.tags.length).toBeGreaterThan(0);
  });

  it("should handle multiple HTTP methods on same path", () => {
    const spec = generateOpenApiSpec();

    // /v1/tasks should have both GET and POST
    expect(spec.paths["/v1/tasks"]).toBeDefined();
    expect(spec.paths["/v1/tasks"].get).toBeDefined();
    expect(spec.paths["/v1/tasks"].post).toBeDefined();

    // Operations should be different
    expect(spec.paths["/v1/tasks"].get.operationId).not.toBe(
      spec.paths["/v1/tasks"].post.operationId
    );
  });

  it("should include descriptions from tool definitions", () => {
    const spec = generateOpenApiSpec();

    // Check that operation summaries come from tool descriptions
    const getTasksOp = spec.paths["/v1/tasks"]?.get;
    expect(getTasksOp.summary).toBeDefined();
    expect(typeof getTasksOp.summary).toBe("string");
    expect(getTasksOp.summary.length).toBeGreaterThan(0);
  });

  it("should serialize to valid JSON", () => {
    const spec = generateOpenApiSpec();

    // Should be able to stringify without errors
    expect(() => JSON.stringify(spec)).not.toThrow();

    // Should be able to parse back
    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json);
    expect(parsed.openapi).toBe("3.0.0");
  });

  it("should only include tools with REST endpoints", () => {
    const spec = generateOpenApiSpec();
    const toolsWithEndpoints = new Set<string>();

    // Count operations in spec
    for (const path of Object.values(spec.paths)) {
      for (const operation of Object.values(path as any)) {
        if ((operation as any).operationId) {
          toolsWithEndpoints.add((operation as any).operationId);
        }
      }
    }

    // Should have some tools but not necessarily all (only those with REST endpoints)
    expect(toolsWithEndpoints.size).toBeGreaterThan(0);
    // With mocked tools, we should have exactly the tools we defined that have endpoints
    expect(toolsWithEndpoints.size).toBe(5);
  });
});
