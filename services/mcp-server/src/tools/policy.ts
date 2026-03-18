/**
 * Policy Domain Registry — Dynamic policy management tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import {
  createPolicy,
  updatePolicy,
  deletePolicy,
  getPolicy,
  listPolicies,
  policyCheck,
} from "../modules/policy.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  policy_create: createPolicy,
  policy_update: updatePolicy,
  policy_delete: deletePolicy,
  policy_get: getPolicy,
  policy_list: listPolicies,
  policy_check: policyCheck,
};

export const definitions = [
  {
    name: "policy_create",
    description:
      "Create a new policy. Operational-tier policies can be created directly. Constitutional-tier requires gsp_seed, architectural-tier requires gsp_propose.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Unique policy ID (e.g., 'no-force-push', 'budget-limit-100')",
          minLength: 1,
          maxLength: 100,
        },
        name: {
          type: "string",
          description: "Human-readable policy name",
          minLength: 1,
          maxLength: 200,
        },
        description: {
          type: "string",
          description: "What this policy does and why it exists",
          minLength: 1,
          maxLength: 1000,
        },
        tier: {
          type: "string",
          description: "Governance tier (operational can be created directly)",
          enum: ["constitutional", "architectural", "operational"],
        },
        enforcement: {
          type: "string",
          description: "How to enforce this policy when violated",
          enum: ["warn", "block", "require_approval"],
        },
        severity: {
          type: "string",
          description: "Violation severity level",
          enum: ["P0", "P1", "P2"],
        },
        rule: {
          type: "object",
          description: "Policy rule definition",
          properties: {
            type: {
              type: "string",
              enum: ["pattern", "threshold", "allowlist", "denylist"],
              description: "Rule type",
            },
            pattern: {
              type: "string",
              description: "Regex pattern for 'pattern' type rules (matched against instructions/title)",
            },
            field: {
              type: "string",
              description: "Field name for 'threshold' type rules (e.g., 'cost_usd', 'tokens_out')",
            },
            operator: {
              type: "string",
              enum: ["gt", "lt", "eq", "gte", "lte"],
              description: "Comparison operator for 'threshold' type rules",
            },
            value: {
              type: "number",
              description: "Comparison value for 'threshold' type rules",
            },
            field_path: {
              type: "string",
              description: "Field path for 'allowlist'/'denylist' type rules (e.g., 'target', 'action', 'priority')",
            },
            values: {
              type: "array",
              items: { type: "string" },
              description: "Allowed/denied values for 'allowlist'/'denylist' type rules",
            },
          },
          required: ["type"],
        },
        scope: {
          type: "object",
          description: "Scope binding (empty arrays = apply to all)",
          properties: {
            programs: {
              type: "array",
              items: { type: "string" },
              description: "Program IDs this policy applies to (empty = all programs)",
            },
            projects: {
              type: "array",
              items: { type: "string" },
              description: "Project IDs this policy applies to (empty = all projects)",
            },
            taskTypes: {
              type: "array",
              items: { type: "string" },
              description: "Task types this policy applies to (empty = all task types)",
            },
          },
        },
        enabled: {
          type: "boolean",
          description: "Whether this policy is enabled",
        },
      },
      required: ["id", "name", "description", "tier", "enforcement", "severity", "rule", "scope", "enabled"],
    },
  },
  {
    name: "policy_update",
    description:
      "Update an existing operational-tier policy. Cannot update constitutional or architectural policies directly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: {
          type: "string",
          description: "Policy ID to update",
          minLength: 1,
        },
        name: {
          type: "string",
          description: "Updated policy name",
          minLength: 1,
          maxLength: 200,
        },
        description: {
          type: "string",
          description: "Updated policy description",
          minLength: 1,
          maxLength: 1000,
        },
        enforcement: {
          type: "string",
          description: "Updated enforcement level",
          enum: ["warn", "block", "require_approval"],
        },
        severity: {
          type: "string",
          description: "Updated severity level",
          enum: ["P0", "P1", "P2"],
        },
        rule: {
          type: "object",
          description: "Updated policy rule",
          properties: {
            type: {
              type: "string",
              enum: ["pattern", "threshold", "allowlist", "denylist"],
            },
            pattern: { type: "string" },
            field: { type: "string" },
            operator: { type: "string", enum: ["gt", "lt", "eq", "gte", "lte"] },
            value: { type: "number" },
            field_path: { type: "string" },
            values: { type: "array", items: { type: "string" } },
          },
        },
        scope: {
          type: "object",
          description: "Updated scope binding",
          properties: {
            programs: { type: "array", items: { type: "string" } },
            projects: { type: "array", items: { type: "string" } },
            taskTypes: { type: "array", items: { type: "string" } },
          },
        },
        enabled: {
          type: "boolean",
          description: "Updated enabled status",
        },
      },
      required: ["policyId"],
    },
  },
  {
    name: "policy_delete",
    description:
      "Delete an operational-tier policy. Cannot delete constitutional or architectural policies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: {
          type: "string",
          description: "Policy ID to delete",
          minLength: 1,
        },
      },
      required: ["policyId"],
    },
  },
  {
    name: "policy_get",
    description: "Get a single policy by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: {
          type: "string",
          description: "Policy ID to retrieve",
          minLength: 1,
        },
      },
      required: ["policyId"],
    },
  },
  {
    name: "policy_list",
    description: "List all policies with optional filters by tier, enforcement, or enabled status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tier: {
          type: "string",
          description: "Filter by governance tier",
          enum: ["constitutional", "architectural", "operational"],
        },
        enforcement: {
          type: "string",
          description: "Filter by enforcement level",
          enum: ["warn", "block", "require_approval"],
        },
        enabled: {
          type: "boolean",
          description: "Filter by enabled status",
        },
      },
    },
  },
  {
    name: "policy_check",
    description:
      "Check if a dispatch would violate any policies without creating a task. Useful for dry-run validation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        instructions: {
          type: "string",
          description: "Task instructions to check",
        },
        title: {
          type: "string",
          description: "Task title to check",
        },
        target: {
          type: "string",
          description: "Target program ID",
        },
        source: {
          type: "string",
          description: "Source program ID",
        },
        action: {
          type: "string",
          description: "Task action",
        },
        priority: {
          type: "string",
          description: "Task priority",
        },
        projectId: {
          type: "string",
          description: "Project ID",
        },
        taskType: {
          type: "string",
          description: "Task type",
        },
        cost_usd: {
          type: "number",
          description: "Expected cost in USD",
        },
        tokens_out: {
          type: "number",
          description: "Expected token output",
        },
        programId: {
          type: "string",
          description: "Program ID for scope matching",
        },
      },
    },
  },
];
