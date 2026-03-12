/**
 * Program State Domain Registry — Program state, context history, and memory tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { getProgramStateHandler, updateProgramStateHandler, storeMemoryHandler, recallMemoryHandler, memoryHealthHandler, deleteMemoryHandler, reinforceMemoryHandler, getContextHistoryHandler } from "../modules/programState.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  state_get_program_state: getProgramStateHandler,
  state_update_program_state: updateProgramStateHandler,
  state_get_context_history: getContextHistoryHandler,
  state_store_memory: storeMemoryHandler,
  state_recall_memory: recallMemoryHandler,
  state_memory_health: memoryHealthHandler,
  state_delete_memory: deleteMemoryHandler,
  state_reinforce_memory: reinforceMemoryHandler,
};

export const definitions = [
  {
    name: "state_get_program_state",
    description: "Read a program's persistent operational state. Programs can read their own state; admin/auditor can read any.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to read state for", maxLength: 100 },
      },
      required: ["programId"],
    },
  },
  {
    name: "state_update_program_state",
    description: "Write a program's persistent operational state. Programs can only write their own state. Partial updates merge with existing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to update state for", maxLength: 100 },
        sessionId: { type: "string", description: "CacheBash session ID writing this state", maxLength: 100 },
        contextSummary: {
          type: "object",
          description: "What the program was doing — written on shutdown, read on boot",
          properties: {
            lastTask: {
              type: "object",
              nullable: true,
              properties: {
                taskId: { type: "string" },
                title: { type: "string", maxLength: 200 },
                outcome: { type: "string", enum: ["completed", "in_progress", "blocked", "deferred"] },
                notes: { type: "string", maxLength: 2000 },
              },
              required: ["taskId", "title", "outcome", "notes"],
            },
            activeWorkItems: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 20 },
            handoffNotes: { type: "string", maxLength: 2000 },
            openQuestions: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 10 },
          },
        },
        learnedPatterns: {
          type: "array",
          description: "Patterns discovered this session — staging area for knowledge store",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              domain: { type: "string", maxLength: 100 },
              pattern: { type: "string", maxLength: 500 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", maxLength: 500 },
              discoveredAt: { type: "string" },
              lastReinforced: { type: "string" },
              promotedToStore: { type: "boolean" },
              stale: { type: "boolean" },
              projectId: { type: "string", maxLength: 100 },
            },
            required: ["id", "domain", "pattern", "confidence", "evidence", "discoveredAt", "lastReinforced"],
          },
        },
        config: {
          type: "object",
          description: "Runtime preferences (not the spec — those are in git)",
          properties: {
            preferredOutputFormat: { type: "string", maxLength: 100, nullable: true },
            toolPreferences: { type: "object", description: "Key-value tool preferences" },
            knownQuirks: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 20 },
            customSettings: { type: "object", description: "Program-specific key-value pairs" },
          },
        },
        baselines: {
          type: "object",
          description: "Performance baselines for self-assessment",
          properties: {
            avgTaskDurationMinutes: { type: "number", nullable: true },
            commonFailureModes: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 10 },
            sessionsCompleted: { type: "number", minimum: 0 },
            lastSessionDurationMinutes: { type: "number", nullable: true },
          },
        },
        decay: {
          type: "object",
          description: "Decay configuration",
          properties: {
            contextSummaryTTLDays: { type: "number", minimum: 1, maximum: 90 },
            learnedPatternMaxAge: { type: "number", minimum: 1, maximum: 365 },
            maxUnpromotedPatterns: { type: "number", minimum: 5, maximum: 200 },
          },
        },
        traceId: { type: "string", description: "Trace correlation ID" },
        spanId: { type: "string", description: "Span ID for this operation" },
        parentSpanId: { type: "string", description: "Parent span ID" },
      },
      required: ["programId"],
    },
  },
  {
    name: "state_get_context_history",
    description: "Query timestamped context snapshots (shadow journal). Returns entries newest-first. Same access rules as get_program_state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to query context history for", maxLength: 100 },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max entries to return (newest first)" },
      },
      required: ["programId"],
    },
  },
  {
    name: "state_store_memory",
    description: "Store a learned pattern into agent memory. Upserts by pattern ID — existing patterns with the same ID are replaced.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to store memory for", maxLength: 100 },
        pattern: {
          type: "object",
          description: "The learned pattern to store",
          properties: {
            id: { type: "string" },
            domain: { type: "string", maxLength: 100 },
            pattern: { type: "string", maxLength: 500 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string", maxLength: 500 },
            discoveredAt: { type: "string" },
            lastReinforced: { type: "string" },
            promotedToStore: { type: "boolean" },
            stale: { type: "boolean" },
            projectId: { type: "string", maxLength: 100, description: "Optional project ID to scope this pattern" },
          },
          required: ["id", "domain", "pattern", "confidence", "evidence", "discoveredAt", "lastReinforced"],
        },
      },
      required: ["programId", "pattern"],
    },
  },
  {
    name: "state_recall_memory",
    description: "Recall learned patterns from agent memory. Supports optional domain filter and text search (grep-style, case-insensitive substring match across pattern, evidence, and domain fields).",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to recall memory for", maxLength: 100 },
        domain: { type: "string", description: "Filter by knowledge domain (exact match)", maxLength: 100 },
        query: { type: "string", description: "Text search across pattern, evidence, and domain fields", maxLength: 200 },
        includeStale: { type: "boolean", default: false, description: "Include stale/expired patterns in results" },
        projectId: { type: "string", description: "Filter by project ID (exact match)", maxLength: 100 },
      },
      required: ["programId"],
    },
  },
  {
    name: "state_memory_health",
    description: "Get memory health summary for a program. Returns pattern counts (total, active, stale, promoted), domains list, last update timestamp, and decay configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to check memory health for", maxLength: 100 },
      },
      required: ["programId"],
    },
  },
  {
    name: "state_delete_memory",
    description: "Delete a learned pattern from agent memory by ID. Hard delete — pattern is removed, not just marked stale.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to delete memory from", maxLength: 100 },
        patternId: { type: "string", description: "ID of the pattern to delete" },
      },
      required: ["programId", "patternId"],
    },
  },
  {
    name: "state_reinforce_memory",
    description: "Reinforce an existing memory pattern. Bumps lastReinforced timestamp, optionally updates confidence and evidence. Resets stale flag.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", description: "Program ID to reinforce memory for", maxLength: 100 },
        patternId: { type: "string", description: "ID of the pattern to reinforce" },
        confidence: { type: "number", minimum: 0, maximum: 1, description: "Updated confidence score (optional)" },
        evidence: { type: "string", maxLength: 500, description: "Updated evidence text (optional)" },
      },
      required: ["programId", "patternId"],
    },
  },
];
