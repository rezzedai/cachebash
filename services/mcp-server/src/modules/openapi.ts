/**
 * OpenAPI 3.0 Spec Generator
 * Auto-generates OpenAPI specification from tool definitions
 */

import { TOOL_DEFINITIONS } from "../tools/index.js";
import { getToolAlias } from "../tools/tool-aliases.js";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, any>;
  components: {
    securitySchemes: Record<string, any>;
    schemas: Record<string, any>;
  };
  security: Array<Record<string, any[]>>;
}

/**
 * Map tool name to REST endpoint path and method.
 * Returns null if tool doesn't have a direct REST endpoint.
 */
function toolToEndpoint(toolName: string): { path: string; method: string } | null {
  // Use alias (old flat name) for endpoint mapping
  const alias = getToolAlias(toolName) || toolName;

  // Dispatch domain
  if (alias === "get_tasks") return { path: "/v1/tasks", method: "get" };
  if (alias === "create_task") return { path: "/v1/tasks", method: "post" };
  if (alias === "get_task_by_id") return { path: "/v1/tasks/{id}", method: "get" };
  if (alias === "claim_task") return { path: "/v1/tasks/{id}/claim", method: "post" };
  if (alias === "complete_task") return { path: "/v1/tasks/{id}/complete", method: "post" };
  if (alias === "unclaim_task") return { path: "/v1/tasks/{id}/unclaim", method: "post" };
  if (alias === "batch_claim_tasks") return { path: "/v1/tasks/batch-claim", method: "post" };
  if (alias === "batch_complete_tasks") return { path: "/v1/tasks/batch-complete", method: "post" };
  if (alias === "dispatch") return { path: "/v1/dispatch", method: "post" };

  // Relay domain
  if (alias === "send_message") return { path: "/v1/messages", method: "post" };
  if (alias === "get_messages") return { path: "/v1/messages", method: "get" };
  if (alias === "get_dead_letters") return { path: "/v1/dead-letters", method: "get" };
  if (alias === "list_groups") return { path: "/v1/relay/groups", method: "get" };
  if (alias === "get_sent_messages") return { path: "/v1/messages/sent", method: "get" };
  if (alias === "query_message_history") return { path: "/v1/messages/history", method: "get" };

  // Pulse domain
  if (alias === "list_sessions") return { path: "/v1/sessions", method: "get" };
  if (alias === "create_session") return { path: "/v1/sessions", method: "post" };
  if (alias === "update_session") return { path: "/v1/sessions/{id}", method: "patch" };
  if (alias === "get_fleet_health") return { path: "/v1/fleet/health", method: "get" };
  if (alias === "write_fleet_snapshot") return { path: "/v1/fleet/snapshots", method: "post" };
  if (alias === "get_fleet_timeline") return { path: "/v1/fleet/timeline", method: "get" };

  // Signal domain
  if (alias === "ask_question") return { path: "/v1/questions", method: "post" };
  if (alias === "get_response") return { path: "/v1/questions/{id}/response", method: "get" };
  if (alias === "send_alert") return { path: "/v1/alerts", method: "post" };

  // Sprint domain
  if (alias === "create_sprint") return { path: "/v1/sprints", method: "post" };
  if (alias === "update_sprint_story") return { path: "/v1/sprints/{id}/stories/{sid}", method: "patch" };
  if (alias === "add_story_to_sprint") return { path: "/v1/sprints/{id}/stories", method: "post" };
  if (alias === "complete_sprint") return { path: "/v1/sprints/{id}/complete", method: "post" };
  if (alias === "get_sprint") return { path: "/v1/sprints/{id}", method: "get" };

  // Metrics domain
  if (alias === "get_cost_summary") return { path: "/v1/metrics/cost-summary", method: "get" };
  if (alias === "get_comms_metrics") return { path: "/v1/metrics/comms", method: "get" };
  if (alias === "get_operational_metrics") return { path: "/v1/metrics/operational", method: "get" };
  if (alias === "get_contention_metrics") return { path: "/v1/metrics/contention", method: "get" };
  if (alias === "get_context_utilization") return { path: "/v1/metrics/context-utilization", method: "get" };
  if (alias === "get_ack_compliance") return { path: "/v1/metrics/ack-compliance", method: "get" };

  // GSP domain
  if (toolName === "gsp_read") return { path: "/v1/gsp/read", method: "post" };
  if (toolName === "gsp_write") return { path: "/v1/gsp/write", method: "post" };
  if (toolName === "gsp_search") return { path: "/v1/gsp/search", method: "post" };

  // Program State domain
  if (alias === "get_program_state") return { path: "/v1/program-state/{programId}", method: "get" };
  if (alias === "update_program_state") return { path: "/v1/program-state/{programId}", method: "patch" };
  if (alias === "get_context_history") return { path: "/v1/program-state/{programId}/context-history", method: "get" };

  // Memory (Phase 1)
  if (alias === "store_memory") return { path: "/v1/memory/{programId}/patterns", method: "post" };
  if (alias === "recall_memory") return { path: "/v1/memory/{programId}/patterns", method: "get" };
  if (alias === "delete_memory") return { path: "/v1/memory/{programId}/patterns/{patternId}", method: "delete" };
  if (alias === "reinforce_memory") return { path: "/v1/memory/{programId}/patterns/{patternId}/reinforce", method: "patch" };
  if (alias === "memory_health") return { path: "/v1/memory/{programId}/health", method: "get" };

  // Keys domain
  if (alias === "create_key") return { path: "/v1/keys", method: "post" };
  if (alias === "revoke_key") return { path: "/v1/keys/{hash}", method: "delete" };
  if (alias === "list_keys") return { path: "/v1/keys", method: "get" };
  if (alias === "rotate_key") return { path: "/v1/keys/rotate", method: "post" };

  // Audit domain
  if (alias === "get_audit") return { path: "/v1/audit", method: "get" };

  // Traces domain
  if (alias === "query_traces") return { path: "/v1/traces", method: "get" };
  if (alias === "query_trace") return { path: "/v1/traces/{traceId}", method: "get" };

  // Feedback domain
  if (alias === "submit_feedback") return { path: "/v1/feedback", method: "post" };

  // Rate Limits
  if (alias === "log_rate_limit_event") return { path: "/v1/rate-limits", method: "post" };
  if (alias === "get_rate_limit_events") return { path: "/v1/rate-limits", method: "get" };

  // Usage & Billing
  if (alias === "get_usage") return { path: "/v1/usage", method: "get" };
  if (alias === "get_invoice") return { path: "/v1/invoices", method: "get" };
  if (alias === "set_budget") return { path: "/v1/budget", method: "put" };

  return null;
}

/**
 * Convert JSON Schema to OpenAPI Schema
 */
function jsonSchemaToOpenAPI(schema: any): any {
  if (!schema) return {};

  // JSON Schema and OpenAPI Schema are mostly compatible
  // Just pass through with minor adjustments
  const result = { ...schema };

  // Remove 'default' from schema level (keep in properties)
  if (result.type === "object" && result.default !== undefined) {
    delete result.default;
  }

  return result;
}

/**
 * Generate OpenAPI operation for a tool
 */
function generateOperation(tool: ToolDefinition, method: string, path: string): any {
  const operation: any = {
    summary: tool.description,
    operationId: tool.name,
    tags: [tool.name.split("_")[0]], // First part of tool name as tag (e.g., "dispatch")
  };

  // Extract path parameters
  const pathParams = (path.match(/\{(\w+)\}/g) || []).map((p) => p.slice(1, -1));

  if (pathParams.length > 0) {
    operation.parameters = pathParams.map((param) => ({
      name: param,
      in: "path",
      required: true,
      schema: { type: "string" },
      description: `${param} parameter`,
    }));
  }

  // Request body for POST/PUT/PATCH
  if (["post", "put", "patch"].includes(method) && tool.inputSchema) {
    const schema = jsonSchemaToOpenAPI(tool.inputSchema);

    // Remove path params from request body schema
    if (schema.properties && pathParams.length > 0) {
      const bodySchema = { ...schema };
      bodySchema.properties = { ...schema.properties };
      bodySchema.required = schema.required ? [...schema.required] : [];

      for (const param of pathParams) {
        delete bodySchema.properties[param];
        const reqIdx = bodySchema.required.indexOf(param);
        if (reqIdx !== -1) {
          bodySchema.required.splice(reqIdx, 1);
        }
      }

      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: bodySchema,
          },
        },
      };
    } else {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema,
          },
        },
      };
    }
  }

  // Query parameters for GET
  if (method === "get" && tool.inputSchema?.properties) {
    const queryParams = [];
    for (const [name, propSchema] of Object.entries(tool.inputSchema.properties)) {
      // Skip path parameters
      if (pathParams.includes(name)) continue;

      queryParams.push({
        name,
        in: "query",
        required: tool.inputSchema.required?.includes(name) || false,
        schema: propSchema,
        description: (propSchema as any).description || name,
      });
    }

    if (queryParams.length > 0) {
      operation.parameters = [...(operation.parameters || []), ...queryParams];
    }
  }

  // Responses
  operation.responses = {
    "200": {
      description: "Successful operation",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "object" },
              meta: {
                type: "object",
                properties: {
                  timestamp: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    "400": {
      description: "Validation error",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean", enum: [false] },
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  issues: { type: "array" },
                },
              },
            },
          },
        },
      },
    },
    "401": {
      description: "Unauthorized - missing or invalid API key",
    },
    "403": {
      description: "Forbidden - insufficient permissions",
    },
    "429": {
      description: "Rate limit exceeded",
    },
    "500": {
      description: "Internal server error",
    },
  };

  // Add 201 for POST methods
  if (method === "post") {
    operation.responses["201"] = {
      description: "Resource created successfully",
      content: operation.responses["200"].content,
    };
  }

  return operation;
}

/**
 * Generate complete OpenAPI 3.0 specification
 */
export function generateOpenApiSpec(): OpenAPISpec {
  const paths: Record<string, any> = {};

  // Process all tool definitions
  for (const tool of TOOL_DEFINITIONS as ToolDefinition[]) {
    const endpoint = toolToEndpoint(tool.name);
    if (!endpoint) continue;

    const { path, method } = endpoint;

    // Initialize path if not exists
    if (!paths[path]) {
      paths[path] = {};
    }

    // Add operation to path
    paths[path][method] = generateOperation(tool, method, path);
  }

  const spec: OpenAPISpec = {
    openapi: "3.0.0",
    info: {
      title: "CacheBash API",
      description: "Multi-agent orchestration and memory management platform. Auto-generated from MCP tool definitions.",
      version: "1.0.0",
    },
    servers: [
      {
        url: "https://api.cachebash.dev",
        description: "Production server",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key authentication. Include your API key in the Authorization header as 'Bearer {api_key}'.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", enum: [false] },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
            meta: {
              type: "object",
              properties: {
                timestamp: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  };

  return spec;
}
