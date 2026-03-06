/**
 * GSP Domain Registry — Grid State Protocol tools.
 * Phase 1 Wave 1: gsp_read, gsp_write, gsp_diff (working) + gsp_bootstrap (stub)
 * Phase 2 stubs: gsp_propose, gsp_subscribe, gsp_resolve
 */
import { AuthContext } from "../auth/authValidator.js";
import {
  gspReadHandler,
  gspWriteHandler,
  gspDiffHandler,
  gspBootstrapHandler,
  gspSeedHandler,
  gspProposeHandler,
  gspSubscribeHandler,
  gspResolveHandler,
} from "../modules/gsp.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  gsp_read: gspReadHandler,
  gsp_write: gspWriteHandler,
  gsp_diff: gspDiffHandler,
  gsp_bootstrap: gspBootstrapHandler,
  gsp_seed: gspSeedHandler,
  gsp_propose: gspProposeHandler,
  gsp_subscribe: gspSubscribeHandler,
  gsp_resolve: gspResolveHandler,
};

export const definitions = [
  {
    name: "gsp_read",
    description: "Read GSP state entries by namespace/key/tier. Returns a single entry or scans a namespace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "GSP namespace (e.g. 'governance', 'runtime')", minLength: 1, maxLength: 100 },
        key: { type: "string", description: "Entry key within the namespace. Omit to scan the entire namespace.", maxLength: 200 },
        tier: {
          type: "string",
          description: "Filter by governance tier",
          enum: ["constitutional", "architectural", "operational"],
        },
        limit: { type: "number", description: "Max entries for namespace scan (default 50)", minimum: 1, maximum: 100, default: 50 },
      },
      required: ["namespace"],
    },
  },
  {
    name: "gsp_write",
    description: "Write an operational GSP state entry. Governance enforcement rejects constitutional/architectural writes with a redirect hint to gsp_propose. Uses Firestore transactions for atomic writes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "GSP namespace", minLength: 1, maxLength: 100 },
        key: { type: "string", description: "Entry key", minLength: 1, maxLength: 200 },
        value: { description: "The state value to store (any JSON-serializable value)" },
        tier: {
          type: "string",
          description: "Governance tier (default: operational). Constitutional/architectural writes are rejected.",
          enum: ["constitutional", "architectural", "operational"],
          default: "operational",
        },
        description: { type: "string", description: "Human-readable description of this entry", maxLength: 500 },
        source: { type: "string", description: "Override the updatedBy field (defaults to programId)", maxLength: 100 },
      },
      required: ["namespace", "key", "value"],
    },
  },
  {
    name: "gsp_diff",
    description: "Diff GSP state entries since a version or timestamp. Returns changed entries for reconciliation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "GSP namespace to diff", minLength: 1, maxLength: 100 },
        sinceVersion: { type: "number", description: "Return entries with version > sinceVersion" },
        sinceTimestamp: { type: "string", description: "Return entries updated after this ISO timestamp" },
        limit: { type: "number", description: "Max entries to return (default 100)", minimum: 1, maximum: 200, default: 100 },
      },
      required: ["namespace"],
    },
  },
  {
    name: "gsp_bootstrap",
    description: "Get full context payload for a program boot. Single call replaces 4+ boot API calls. Returns identity, constitutional state, operational state, program memory, and pending context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { 
          type: "string", 
          description: "Program ID to bootstrap (e.g., 'vector', 'iso', 'basher')", 
          minLength: 1, 
          maxLength: 100 
        },
        depth: {
          type: "string",
          description: "Payload depth tier: 'essential' (~2KB, builders), 'standard' (~5KB, default), 'full' (~10-15KB, VECTOR/ISO)",
          enum: ["essential", "standard", "full"],
          default: "standard"
        },
      },
      required: ["programId"],
    },
  },
  {
    name: "gsp_seed",
    description: "Seed constitutional or architectural state into GSP. Admin/orchestrator only. Bypasses gsp_write governance enforcement for authorized seeding.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Target namespace (e.g., 'constitution', 'architecture')", minLength: 1, maxLength: 100 },
        entries: {
          type: "array",
          description: "Array of entries to seed",
          items: {
            type: "object",
            properties: {
              key: { type: "string", maxLength: 200 },
              value: { description: "The state value" },
              tier: { type: "string", enum: ["constitutional", "architectural"] },
              description: { type: "string", maxLength: 500 },
            },
            required: ["key", "value", "tier"],
          },
        },
        overwrite: { type: "boolean", description: "Overwrite existing entries (default false)", default: false },
      },
      required: ["namespace", "entries"],
    },
  },
  {
    name: "gsp_propose",
    description: "Propose a change to constitutional or architectural state. Creates a governance proposal for review. Operational state should use gsp_write instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Target namespace", minLength: 1, maxLength: 100 },
        key: { type: "string", description: "Entry key", minLength: 1, maxLength: 200 },
        proposedValue: { description: "Proposed new value (any JSON-serializable value)" },
        rationale: { type: "string", description: "Reason for the proposed change", minLength: 1, maxLength: 1000 },
        evidence: { type: "string", description: "Optional supporting evidence or context", maxLength: 2000 },
      },
      required: ["namespace", "key", "proposedValue", "rationale"],
    },
  },
  {
    name: "gsp_subscribe",
    description: "Subscribe to GSP state change notifications. Phase 2 — not yet implemented.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace to watch", maxLength: 100 },
        key: { type: "string", description: "Specific key to watch (omit for all keys)", maxLength: 200 },
        tier: { type: "string", enum: ["constitutional", "architectural", "operational"] },
      },
      required: ["namespace"],
    },
  },
  {
    name: "gsp_resolve",
    description: "Resolve a pending governance proposal. Phase 2 — not yet implemented.",
    inputSchema: {
      type: "object" as const,
      properties: {
        proposalId: { type: "string", description: "ID of the proposal to resolve" },
        decision: { type: "string", enum: ["approve", "reject"], description: "Approval decision" },
        reason: { type: "string", description: "Reason for the decision", maxLength: 1000 },
      },
      required: ["proposalId", "decision"],
    },
  },
];
