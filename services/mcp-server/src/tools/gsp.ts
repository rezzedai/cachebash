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
    description: "Bootstrap constitutional state from git into GSP Firestore. Phase 2 — not yet implemented.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Target namespace", maxLength: 100 },
        commitHash: { type: "string", description: "Git commit hash to sync from" },
        dryRun: { type: "boolean", description: "Preview without writing", default: false },
      },
      required: ["namespace"],
    },
  },
  {
    name: "gsp_propose",
    description: "Propose a change to constitutional or architectural state. Phase 2 — not yet implemented.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Target namespace", maxLength: 100 },
        key: { type: "string", description: "Entry key", maxLength: 200 },
        value: { description: "Proposed new value" },
        tier: { type: "string", enum: ["constitutional", "architectural"] },
        rationale: { type: "string", description: "Reason for the proposed change", maxLength: 1000 },
      },
      required: ["namespace", "key", "value", "tier", "rationale"],
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
