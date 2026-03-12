/**
 * Pattern Consolidation Tools — GSP-P5
 * Tools for auto-promoting convergent patterns from agent learned patterns to shared knowledge.
 */
import { AuthContext } from "../auth/authValidator.js";
import {
  consolidatePatternsHandler,
  getConsolidatedPatternsHandler,
} from "../modules/patternConsolidation.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  pattern_consolidate: consolidatePatternsHandler,
  pattern_get_consolidated: getConsolidatedPatternsHandler,
};

export const definitions = [
  {
    name: "pattern_consolidate",
    description: "Scan all program states for learned patterns and auto-promote patterns when N+ agents have learned the same pattern. Promoted patterns are written to GSP knowledge store with tier 'architectural' and key format 'pattern/{domain}/{slug}'. Tracks provenance (contributors, confidence, evidence count).",
    inputSchema: {
      type: "object" as const,
      properties: {
        threshold: {
          type: "number",
          description: "Minimum number of agents required to promote a pattern (default: 2)",
          minimum: 1,
          maximum: 10,
          default: 2,
        },
        dryRun: {
          type: "boolean",
          description: "If true, scan and report what would be promoted without actually promoting (default: false)",
          default: false,
        },
        domain: {
          type: "string",
          description: "Optional domain filter - only consolidate patterns from this domain",
          maxLength: 100,
        },
        projectId: {
          type: "string",
          description: "Optional: only consolidate patterns from this project",
          maxLength: 100,
        },
      },
    },
  },
  {
    name: "pattern_get_consolidated",
    description: "Retrieve all consolidated/promoted patterns from the GSP knowledge store. Returns patterns grouped by domain with aggregate stats (confidence, contributor count, evidence count).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];
