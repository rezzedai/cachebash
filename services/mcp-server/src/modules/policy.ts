/**
 * Policy Engine Module — Dynamic policy rules with scope binding and enforcement.
 *
 * Stores policies in GSP namespace "policies".
 * Evaluates policies during dispatch pre-flight and provides standalone check.
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { gspWriteHandler, gspReadHandler } from "./gsp.js";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type PolicyTier = "constitutional" | "architectural" | "operational";
export type PolicyEnforcement = "warn" | "block" | "require_approval";
export type PolicySeverity = "P0" | "P1" | "P2";
export type RuleType = "pattern" | "threshold" | "allowlist" | "denylist";

export interface PolicyRule {
  type: RuleType;
  // For "pattern": regex match against instructions/title
  pattern?: string;
  // For "threshold": numeric comparison
  field?: string; // e.g., "cost_usd", "tokens_out"
  operator?: "gt" | "lt" | "eq" | "gte" | "lte";
  value?: number;
  // For "allowlist"/"denylist": list of allowed/denied values
  field_path?: string; // e.g., "target", "action", "priority"
  values?: string[];
}

export interface PolicyScope {
  programs?: string[]; // Apply to these programs (empty = all)
  projects?: string[]; // Apply to these projects (empty = all)
  taskTypes?: string[]; // Apply to these task types (empty = all)
}

export interface Policy {
  id: string; // e.g., "no-force-push", "budget-limit-100"
  name: string; // Human-readable name
  description: string; // What this policy does
  tier: PolicyTier;
  enforcement: PolicyEnforcement;
  severity: PolicySeverity;
  rule: PolicyRule;
  scope: PolicyScope;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PolicyEvaluation {
  policyId: string;
  policyName: string;
  matched: boolean;
  enforcement: PolicyEnforcement;
  severity: PolicySeverity;
  message: string;
}

export interface EvaluationContext {
  instructions?: string;
  title?: string;
  target?: string;
  source?: string;
  action?: string;
  priority?: string;
  projectId?: string;
  taskType?: string;
  cost_usd?: number;
  tokens_out?: number;
  programId?: string; // The program ID (source or target depending on use case)
}

// ─── ZOD SCHEMAS ────────────────────────────────────────────────────────────

const PolicyRuleSchema = z.object({
  type: z.enum(["pattern", "threshold", "allowlist", "denylist"]),
  pattern: z.string().optional(),
  field: z.string().optional(),
  operator: z.enum(["gt", "lt", "eq", "gte", "lte"]).optional(),
  value: z.number().optional(),
  field_path: z.string().optional(),
  values: z.array(z.string()).optional(),
});

const PolicyScopeSchema = z.object({
  programs: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  taskTypes: z.array(z.string()).optional(),
});

const PolicySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  tier: z.enum(["constitutional", "architectural", "operational"]),
  enforcement: z.enum(["warn", "block", "require_approval"]),
  severity: z.enum(["P0", "P1", "P2"]),
  rule: PolicyRuleSchema,
  scope: PolicyScopeSchema,
  enabled: z.boolean(),
});

const PolicyCreateSchema = PolicySchema;

const PolicyUpdateSchema = z.object({
  policyId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(1000).optional(),
  enforcement: z.enum(["warn", "block", "require_approval"]).optional(),
  severity: z.enum(["P0", "P1", "P2"]).optional(),
  rule: PolicyRuleSchema.optional(),
  scope: PolicyScopeSchema.optional(),
  enabled: z.boolean().optional(),
});

const PolicyGetSchema = z.object({
  policyId: z.string().min(1),
});

const PolicyDeleteSchema = z.object({
  policyId: z.string().min(1),
});

const PolicyListSchema = z.object({
  tier: z.enum(["constitutional", "architectural", "operational"]).optional(),
  enforcement: z.enum(["warn", "block", "require_approval"]).optional(),
  enabled: z.boolean().optional(),
});

const PolicyCheckSchema = z.object({
  instructions: z.string().optional(),
  title: z.string().optional(),
  target: z.string().optional(),
  source: z.string().optional(),
  action: z.string().optional(),
  priority: z.string().optional(),
  projectId: z.string().optional(),
  taskType: z.string().optional(),
  cost_usd: z.number().optional(),
  tokens_out: z.number().optional(),
  programId: z.string().optional(),
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const GSP_NAMESPACE = "policies";

// ─── POLICY CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new policy.
 * Constitutional-tier policies can only be created via gsp_seed.
 * Architectural-tier policies require gsp_propose + gsp_resolve.
 * Operational-tier policies can be created directly.
 */
export async function createPolicy(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyCreateSchema.parse(rawArgs);

  // Enforce tier restrictions
  if (args.tier === "constitutional") {
    return jsonResult({
      success: false,
      error: "Constitutional-tier policies can only be created via gsp_seed.",
      hint: "Use gsp_seed to seed constitutional policies from the git repository.",
    });
  }

  if (args.tier === "architectural") {
    return jsonResult({
      success: false,
      error: "Architectural-tier policies require gsp_propose + gsp_resolve.",
      hint: "Use gsp_propose to propose the policy change, then gsp_resolve to finalize it.",
    });
  }

  // Check if policy already exists
  const existingCheck = await gspReadHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.id,
  });

  const existingData = JSON.parse(existingCheck.content[0].text);
  if (existingData.found) {
    return jsonResult({
      success: false,
      error: `Policy with id "${args.id}" already exists.`,
    });
  }

  // Create the policy
  const now = new Date().toISOString();
  const policy: Policy = {
    ...args,
    createdBy: auth.userId,
    createdAt: now,
  };

  const result = await gspWriteHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.id,
    value: policy,
    tier: args.tier,
    description: `Policy: ${args.name}`,
  });

  const resultData = JSON.parse(result.content[0].text);

  if (!resultData.success) {
    return result;
  }

  return jsonResult({
    success: true,
    policy,
    message: `Policy "${args.name}" (${args.id}) created successfully.`,
  });
}

/**
 * Update an existing policy.
 * Cannot change tier or id. Cannot update constitutional-tier policies.
 */
export async function updatePolicy(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyUpdateSchema.parse(rawArgs);

  // Fetch existing policy
  const existingResult = await gspReadHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.policyId,
  });

  const existingData = JSON.parse(existingResult.content[0].text);
  if (!existingData.found) {
    return jsonResult({
      success: false,
      error: `Policy "${args.policyId}" not found.`,
    });
  }

  const existingPolicy = existingData.entry.value as Policy;

  // Cannot update constitutional-tier policies
  if (existingPolicy.tier === "constitutional") {
    return jsonResult({
      success: false,
      error: "Cannot update constitutional-tier policies via policy_update.",
      hint: "Constitutional policies must be updated via gsp_seed from the git repository.",
    });
  }

  // Cannot update architectural-tier policies
  if (existingPolicy.tier === "architectural") {
    return jsonResult({
      success: false,
      error: "Cannot update architectural-tier policies via policy_update.",
      hint: "Use gsp_propose + gsp_resolve to update architectural policies.",
    });
  }

  // Merge updates
  const now = new Date().toISOString();
  const updatedPolicy: Policy = {
    ...existingPolicy,
    ...args,
    id: args.policyId, // Cannot change id
    tier: existingPolicy.tier, // Cannot change tier
    updatedAt: now,
    updatedBy: auth.userId,
  };

  const result = await gspWriteHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.policyId,
    value: updatedPolicy,
    tier: existingPolicy.tier,
    description: `Policy: ${updatedPolicy.name}`,
  });

  const resultData = JSON.parse(result.content[0].text);

  if (!resultData.success) {
    return result;
  }

  return jsonResult({
    success: true,
    policy: updatedPolicy,
    message: `Policy "${args.policyId}" updated successfully.`,
  });
}

/**
 * Delete a policy.
 * Cannot delete constitutional-tier policies.
 */
export async function deletePolicy(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyDeleteSchema.parse(rawArgs);

  // Fetch existing policy
  const existingResult = await gspReadHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.policyId,
  });

  const existingData = JSON.parse(existingResult.content[0].text);
  if (!existingData.found) {
    return jsonResult({
      success: false,
      error: `Policy "${args.policyId}" not found.`,
    });
  }

  const existingPolicy = existingData.entry.value as Policy;

  // Cannot delete constitutional-tier policies
  if (existingPolicy.tier === "constitutional") {
    return jsonResult({
      success: false,
      error: "Cannot delete constitutional-tier policies.",
      hint: "Constitutional policies are immutable and can only be seeded via gsp_seed.",
    });
  }

  // Cannot delete architectural-tier policies
  if (existingPolicy.tier === "architectural") {
    return jsonResult({
      success: false,
      error: "Cannot delete architectural-tier policies via policy_delete.",
      hint: "Use gsp_propose + gsp_resolve to remove architectural policies.",
    });
  }

  // Delete the policy by writing a tombstone or using Firestore delete
  const db = getFirestore();
  const docPath = `tenants/${auth.userId}/gsp/${GSP_NAMESPACE}/entries/${args.policyId}`;
  await db.doc(docPath).delete();

  return jsonResult({
    success: true,
    message: `Policy "${args.policyId}" deleted successfully.`,
  });
}

/**
 * Get a single policy by ID.
 */
export async function getPolicy(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyGetSchema.parse(rawArgs);

  const result = await gspReadHandler(auth, {
    namespace: GSP_NAMESPACE,
    key: args.policyId,
  });

  const resultData = JSON.parse(result.content[0].text);

  if (!resultData.found) {
    return jsonResult({
      success: false,
      error: `Policy "${args.policyId}" not found.`,
    });
  }

  return jsonResult({
    success: true,
    policy: resultData.entry.value,
  });
}

/**
 * List all policies with optional filters.
 */
export async function listPolicies(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyListSchema.parse(rawArgs);

  const result = await gspReadHandler(auth, {
    namespace: GSP_NAMESPACE,
    tier: args.tier,
    limit: 100,
  });

  const resultData = JSON.parse(result.content[0].text);

  let policies = (resultData.entries || []).map((entry: any) => entry.value as Policy);

  // Apply filters
  if (args.enforcement !== undefined) {
    policies = policies.filter((p: Policy) => p.enforcement === args.enforcement);
  }

  if (args.enabled !== undefined) {
    policies = policies.filter((p: Policy) => p.enabled === args.enabled);
  }

  return jsonResult({
    success: true,
    policies,
    count: policies.length,
    message: `Found ${policies.length} policies.`,
  });
}

// ─── POLICY EVALUATION ENGINE ───────────────────────────────────────────────

/**
 * Evaluate policies against a dispatch context.
 * Returns all matched policies with enforcement details.
 */
export async function evaluatePolicies(
  auth: AuthContext,
  context: EvaluationContext
): Promise<PolicyEvaluation[]> {
  // Fetch all enabled policies
  const result = await listPolicies(auth, { enabled: true });
  const resultData = JSON.parse(result.content[0].text);
  const policies: Policy[] = resultData.policies || [];

  const evaluations: PolicyEvaluation[] = [];

  for (const policy of policies) {
    // Check scope match
    if (!matchesScope(policy.scope, context)) {
      continue; // Policy doesn't apply to this context
    }

    // Evaluate rule
    const matched = evaluateRule(policy.rule, context);

    evaluations.push({
      policyId: policy.id,
      policyName: policy.name,
      matched,
      enforcement: policy.enforcement,
      severity: policy.severity,
      message: matched
        ? `Policy "${policy.name}" matched: ${policy.description}`
        : `Policy "${policy.name}" did not match`,
    });
  }

  return evaluations;
}

/**
 * Check if a policy's scope matches the evaluation context.
 */
function matchesScope(scope: PolicyScope, context: EvaluationContext): boolean {
  // If scope is empty, it applies to all
  const hasNoScope =
    (!scope.programs || scope.programs.length === 0) &&
    (!scope.projects || scope.projects.length === 0) &&
    (!scope.taskTypes || scope.taskTypes.length === 0);

  if (hasNoScope) {
    return true;
  }

  // Check program scope (matches source or target)
  if (scope.programs && scope.programs.length > 0) {
    const programMatch =
      (context.source && scope.programs.includes(context.source)) ||
      (context.target && scope.programs.includes(context.target)) ||
      (context.programId && scope.programs.includes(context.programId));

    if (programMatch) {
      return true;
    }
  }

  // Check project scope
  if (scope.projects && scope.projects.length > 0) {
    if (context.projectId && scope.projects.includes(context.projectId)) {
      return true;
    }
  }

  // Check task type scope
  if (scope.taskTypes && scope.taskTypes.length > 0) {
    if (context.taskType && scope.taskTypes.includes(context.taskType)) {
      return true;
    }
  }

  // If we have scope restrictions but nothing matched, return false
  return false;
}

/**
 * Evaluate a policy rule against the context.
 */
function evaluateRule(rule: PolicyRule, context: EvaluationContext): boolean {
  switch (rule.type) {
    case "pattern":
      return evaluatePattern(rule, context);
    case "threshold":
      return evaluateThreshold(rule, context);
    case "allowlist":
      return evaluateAllowlist(rule, context);
    case "denylist":
      return evaluateDenylist(rule, context);
    default:
      return false;
  }
}

/**
 * Evaluate a pattern rule (regex match against instructions/title).
 */
function evaluatePattern(rule: PolicyRule, context: EvaluationContext): boolean {
  if (!rule.pattern) {
    return false;
  }

  const text = [context.instructions || "", context.title || ""].join(" ");
  const regex = new RegExp(rule.pattern, "i");
  return regex.test(text);
}

/**
 * Evaluate a threshold rule (numeric comparison).
 */
function evaluateThreshold(rule: PolicyRule, context: EvaluationContext): boolean {
  if (!rule.field || !rule.operator || rule.value === undefined) {
    return false;
  }

  const contextValue = (context as any)[rule.field];
  if (typeof contextValue !== "number") {
    return false;
  }

  switch (rule.operator) {
    case "gt":
      return contextValue > rule.value;
    case "lt":
      return contextValue < rule.value;
    case "eq":
      return contextValue === rule.value;
    case "gte":
      return contextValue >= rule.value;
    case "lte":
      return contextValue <= rule.value;
    default:
      return false;
  }
}

/**
 * Evaluate an allowlist rule (field value must be in allowed list).
 */
function evaluateAllowlist(rule: PolicyRule, context: EvaluationContext): boolean {
  if (!rule.field_path || !rule.values || rule.values.length === 0) {
    return false;
  }

  const fieldValue = (context as any)[rule.field_path];
  if (!fieldValue) {
    return false;
  }

  // If value is in allowlist, rule does NOT match (no violation)
  // If value is NOT in allowlist, rule matches (violation)
  return !rule.values.includes(fieldValue);
}

/**
 * Evaluate a denylist rule (field value must NOT be in denied list).
 */
function evaluateDenylist(rule: PolicyRule, context: EvaluationContext): boolean {
  if (!rule.field_path || !rule.values || rule.values.length === 0) {
    return false;
  }

  const fieldValue = (context as any)[rule.field_path];
  if (!fieldValue) {
    return false;
  }

  // If value is in denylist, rule matches (violation)
  return rule.values.includes(fieldValue);
}

// ─── POLICY CHECK TOOL ──────────────────────────────────────────────────────

/**
 * Standalone policy check without creating a task.
 * Useful for dry-run validation before dispatch.
 */
export async function policyCheck(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = PolicyCheckSchema.parse(rawArgs);

  const evaluations = await evaluatePolicies(auth, args);

  const matched = evaluations.filter((e) => e.matched);
  const warnings = matched.filter((e) => e.enforcement === "warn");
  const blockers = matched.filter((e) => e.enforcement === "block");
  const approvals = matched.filter((e) => e.enforcement === "require_approval");

  return jsonResult({
    success: true,
    evaluations: matched,
    summary: {
      total_matched: matched.length,
      warnings: warnings.length,
      blockers: blockers.length,
      approvals: approvals.length,
    },
    would_block: blockers.length > 0,
    would_require_approval: approvals.length > 0,
    message:
      blockers.length > 0
        ? `Dispatch would be blocked by ${blockers.length} policy/policies.`
        : approvals.length > 0
        ? `Dispatch would require approval due to ${approvals.length} policy/policies.`
        : warnings.length > 0
        ? `Dispatch would proceed with ${warnings.length} warning(s).`
        : "No policy violations detected.",
  });
}
