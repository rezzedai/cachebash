/**
 * Program State Module — Persistent operational memory for programs.
 * Collection: tenants/{uid}/sessions/_meta/program_state/{programId}
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/authValidator.js";
import { isRegisteredProgram } from "../config/programs.js";
import { verifySource } from "../middleware/gate.js";
import { z } from "zod";
import type { ProgramState } from "../types/programState.js";

const GetProgramStateSchema = z.object({
  programId: z.string().max(100),
});

const LearnedPatternSchema = z.object({
  id: z.string(),
  domain: z.string().max(100),
  pattern: z.string().max(500),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(500),
  discoveredAt: z.string(),
  lastReinforced: z.string(),
  promotedToStore: z.boolean().default(false),
  stale: z.boolean().default(false),
});

const UpdateProgramStateSchema = z.object({
  programId: z.string().max(100),
  sessionId: z.string().max(100).optional(),
  contextSummary: z.object({
    lastTask: z.object({
      taskId: z.string(),
      title: z.string().max(200),
      outcome: z.enum(["completed", "in_progress", "blocked", "deferred"]),
      notes: z.string().max(2000),
    }).nullable().optional(),
    activeWorkItems: z.array(z.string().max(200)).max(20).optional(),
    handoffNotes: z.string().max(2000).optional(),
    openQuestions: z.array(z.string().max(500)).max(10).optional(),
  }).optional(),
  learnedPatterns: z.array(LearnedPatternSchema).optional(),
  config: z.object({
    preferredOutputFormat: z.string().max(100).nullable().optional(),
    toolPreferences: z.record(z.string(), z.string().max(100)).optional(),
    knownQuirks: z.array(z.string().max(200)).max(20).optional(),
    customSettings: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  baselines: z.object({
    avgTaskDurationMinutes: z.number().nullable().optional(),
    commonFailureModes: z.array(z.string().max(200)).max(10).optional(),
    sessionsCompleted: z.number().min(0).optional(),
    lastSessionDurationMinutes: z.number().nullable().optional(),
  }).optional(),
  decay: z.object({
    contextSummaryTTLDays: z.number().min(1).max(90).optional(),
    learnedPatternMaxAge: z.number().min(1).max(365).optional(),
    maxUnpromotedPatterns: z.number().min(5).max(200).optional(),
  }).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function defaultState(programId: string, sessionId: string): ProgramState {
  const now = new Date().toISOString();
  return {
    programId,
    version: 1,
    lastUpdatedBy: programId,
    lastUpdatedAt: now,
    sessionId,
    contextSummary: {
      lastTask: null,
      activeWorkItems: [],
      handoffNotes: "",
      openQuestions: [],
    },
    learnedPatterns: [],
    config: {
      preferredOutputFormat: null,
      toolPreferences: {},
      knownQuirks: [],
      customSettings: {},
    },
    baselines: {
      avgTaskDurationMinutes: null,
      commonFailureModes: [],
      sessionsCompleted: 0,
      lastSessionDurationMinutes: null,
    },
    decay: {
      contextSummaryTTLDays: 7,
      learnedPatternMaxAge: 30,
      maxUnpromotedPatterns: 50,
      lastDecayRun: now,
      decayLog: [],
    },
  };
}

/**
 * Access control:
 * - Programs can read their own state
 * - Auditor can read any program's state (audit)
 * - Admin (legacy/mobile) can read any program's state
 */
function canRead(auth: AuthContext, targetProgramId: string): boolean {
  if (auth.programId === "legacy" || auth.programId === "mobile") return true;
  if (auth.programId === "orchestrator" || auth.programId === "iso" || auth.programId === "auditor") return true;
  return auth.programId === targetProgramId;
}

/**
 * Access control:
 * - Programs can only write their own state
 * - Admin (legacy/mobile) can write any state
 */
function canWrite(auth: AuthContext, targetProgramId: string): boolean {
  if (auth.programId === "legacy" || auth.programId === "mobile") return true;
  return auth.programId === targetProgramId;
}


interface DecayResult {
  state: any;
  decayed: boolean;
  patternsMarkedStale: number;
  contextCleared: boolean;
}

function applyDecay(state: any): DecayResult {
  const decay = state.decay || {};
  const now = Date.now();
  let decayed = false;
  let patternsMarkedStale = 0;
  let contextCleared = false;

  // 1. Context Summary TTL
  const contextTTLDays = decay.contextSummaryTTLDays || 7;
  if (state.contextSummary?.lastTask) {
    const lastTask = state.contextSummary.lastTask;
    // Only clear if task was completed (not in-progress or blocked)
    if (lastTask.outcome === "completed") {
      // Check if lastTask has a timestamp we can use
      // The contextSummary doesn't have a direct timestamp, so use lastUpdatedAt from the state
      const lastUpdated = state.lastUpdatedAt;
      if (lastUpdated) {
        const updatedAt = typeof lastUpdated === 'string' ? new Date(lastUpdated).getTime() :
                          lastUpdated._seconds ? lastUpdated._seconds * 1000 :
                          lastUpdated.toDate ? lastUpdated.toDate().getTime() : 0;
        const ttlMs = contextTTLDays * 24 * 60 * 60 * 1000;
        if (updatedAt > 0 && (now - updatedAt) > ttlMs) {
          state.contextSummary = {
            lastTask: null,
            activeWorkItems: [],
            handoffNotes: "",
            openQuestions: [],
          };
          contextCleared = true;
          decayed = true;
        }
      }
    }
  }

  // 2. Learned Pattern Max Age
  const maxAgeDays = decay.learnedPatternMaxAge || 30;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (Array.isArray(state.learnedPatterns)) {
    for (const pattern of state.learnedPatterns) {
      if (pattern.stale) continue; // already stale
      if (pattern.promotedToStore) continue; // promoted patterns don't decay
      const reinforced = new Date(pattern.lastReinforced).getTime();
      if (!isNaN(reinforced) && (now - reinforced) > maxAgeMs) {
        pattern.stale = true;
        patternsMarkedStale++;
        decayed = true;
      }
    }
  }

  // 3. Max Unpromoted Patterns (already enforced on write, but also enforce on read for consistency)
  const maxUnpromoted = decay.maxUnpromotedPatterns || 50;
  if (Array.isArray(state.learnedPatterns)) {
    const unpromoted = state.learnedPatterns.filter((p: any) => !p.promotedToStore && !p.stale);
    if (unpromoted.length > maxUnpromoted) {
      unpromoted.sort((a: any, b: any) => a.confidence - b.confidence);
      const excess = unpromoted.slice(0, unpromoted.length - maxUnpromoted);
      for (const p of excess) {
        p.stale = true;
        patternsMarkedStale++;
        decayed = true;
      }
    }
  }

  // Update decay metadata
  if (decayed) {
    state.decay = {
      ...decay,
      lastDecayRun: new Date().toISOString(),
      decayLog: [
        ...(decay.decayLog || []).slice(-9), // keep last 10 entries
        {
          timestamp: new Date().toISOString(),
          patternsMarkedStale,
          contextCleared,
        },
      ],
    };
  }

  return { state, decayed, patternsMarkedStale, contextCleared };
}

export async function getProgramStateHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetProgramStateSchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canRead(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read state for "${args.programId}"` });
  }

  // Audit cross-program state reads (transparency on state access)
  if (auth.programId !== args.programId) {
    const { emitEvent } = await import("./events.js");
    emitEvent(auth.userId, {
      event_type: "STATE_CROSS_READ" as any,
      program_id: auth.programId,
      target_program: args.programId,
      reader_role: auth.programId,
    });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: true,
      exists: false,
      state: defaultState(args.programId, "none"),
      message: `No persisted state for "${args.programId}". Returning defaults.`,
    });
  }

  const data = doc.data()!;

  // Apply decay before returning state
  const { state: decayedState, decayed, patternsMarkedStale, contextCleared } = applyDecay({ ...data });

  // Write decayed state back to Firestore if anything changed (merge update)
  if (decayed) {
    const { emitEvent } = await import("./events.js");
    
    // Merge update — only write changed fields
    await docRef.update({
      contextSummary: decayedState.contextSummary,
      learnedPatterns: decayedState.learnedPatterns,
      decay: decayedState.decay,
    });
    
    emitEvent(auth.userId, {
      event_type: "STATE_DECAY" as any,
      program_id: args.programId,
      patterns_decayed: patternsMarkedStale,
      patterns_remaining: (decayedState.learnedPatterns || []).filter((p: any) => !p.stale).length,
      context_cleared: contextCleared,
    });
  }

  return jsonResult({
    success: true,
    exists: true,
    state: decayedState,
    message: `State loaded for "${args.programId}".${decayed ? ` Decay applied: ${patternsMarkedStale} patterns marked stale${contextCleared ? ', context cleared' : ''}.` : ''}`,
  });
}

// === Memory-as-Product Phase 1 ===

const StoreMemorySchema = z.object({
  programId: z.string().max(100),
  pattern: LearnedPatternSchema,
});

const RecallMemorySchema = z.object({
  programId: z.string().max(100),
  domain: z.string().max(100).optional(),
  query: z.string().max(200).optional(),
  includeStale: z.boolean().default(false),
});

const MemoryHealthSchema = z.object({
  programId: z.string().max(100),
});

/**
 * store_memory — Upsert a single learned pattern into program state.
 * If a pattern with the same ID exists, it is replaced. Otherwise it is appended.
 * Enforces maxUnpromotedPatterns cap.
 */
export async function storeMemoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = StoreMemorySchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canWrite(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const existing = await docRef.get();

  const now = new Date().toISOString();
  const base = existing.exists ? existing.data()! : defaultState(args.programId, "unknown");

  let patterns: any[] = Array.isArray(base.learnedPatterns) ? [...base.learnedPatterns] : [];

  // Upsert: replace if same ID exists, otherwise append
  const existingIdx = patterns.findIndex((p: any) => p.id === args.pattern.id);
  if (existingIdx >= 0) {
    patterns[existingIdx] = args.pattern;
  } else {
    patterns.push(args.pattern);
  }

  // Enforce maxUnpromotedPatterns cap
  const maxUnpromoted = base.decay?.maxUnpromotedPatterns || 50;
  const unpromoted = patterns.filter((p: any) => !p.promotedToStore && !p.stale);
  if (unpromoted.length > maxUnpromoted) {
    unpromoted.sort((a: any, b: any) => a.confidence - b.confidence);
    const toEvict = new Set(unpromoted.slice(0, unpromoted.length - maxUnpromoted).map((p: any) => p.id));
    patterns = patterns.filter((p: any) => p.promotedToStore || p.stale || !toEvict.has(p.id));
  }

  // Merge update — only touch learnedPatterns + provenance
  await docRef.set({
    ...base,
    learnedPatterns: patterns,
    lastUpdatedBy: auth.programId,
    lastUpdatedAt: now,
    version: (base.version || 0) + 1,
  });

  return jsonResult({
    success: true,
    programId: args.programId,
    patternId: args.pattern.id,
    action: existingIdx >= 0 ? "updated" : "created",
    patternsCount: patterns.length,
    message: `Pattern "${args.pattern.id}" ${existingIdx >= 0 ? "updated" : "stored"} for "${args.programId}".`,
  });
}

/**
 * recall_memory — Read learned patterns with optional domain filter and text search.
 * Grep-style: matches query substring against pattern text and evidence fields.
 */
export async function recallMemoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = RecallMemorySchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canRead(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read memory for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: true,
      programId: args.programId,
      patterns: [],
      total: 0,
      message: `No memory found for "${args.programId}".`,
    });
  }

  const data = doc.data()!;
  let patterns: any[] = Array.isArray(data.learnedPatterns) ? data.learnedPatterns : [];

  // Filter out stale unless requested
  if (!args.includeStale) {
    patterns = patterns.filter((p: any) => !p.stale);
  }

  // Domain filter (exact match)
  if (args.domain) {
    patterns = patterns.filter((p: any) => p.domain === args.domain);
  }

  // Text search (case-insensitive substring match across pattern + evidence + domain)
  if (args.query) {
    const q = args.query.toLowerCase();
    patterns = patterns.filter((p: any) =>
      (p.pattern && p.pattern.toLowerCase().includes(q)) ||
      (p.evidence && p.evidence.toLowerCase().includes(q)) ||
      (p.domain && p.domain.toLowerCase().includes(q))
    );
  }

  return jsonResult({
    success: true,
    programId: args.programId,
    patterns,
    total: patterns.length,
    filters: {
      domain: args.domain || null,
      query: args.query || null,
      includeStale: args.includeStale,
    },
    message: `Found ${patterns.length} pattern(s) for "${args.programId}".`,
  });
}

/**
 * memory_health — Summary of memory state per program.
 * Returns pattern counts, staleness, domains, last update, decay config.
 */
export async function memoryHealthHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = MemoryHealthSchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canRead(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read memory health for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: true,
      programId: args.programId,
      exists: false,
      health: {
        totalPatterns: 0,
        activePatterns: 0,
        stalePatterns: 0,
        promotedPatterns: 0,
        domains: [],
        lastUpdatedAt: null,
        lastUpdatedBy: null,
      },
      message: `No memory state for "${args.programId}".`,
    });
  }

  const data = doc.data()!;
  const patterns: any[] = Array.isArray(data.learnedPatterns) ? data.learnedPatterns : [];

  const stalePatterns = patterns.filter((p: any) => p.stale);
  const promotedPatterns = patterns.filter((p: any) => p.promotedToStore);
  const activePatterns = patterns.filter((p: any) => !p.stale);
  const domains = [...new Set(patterns.map((p: any) => p.domain).filter(Boolean))];

  return jsonResult({
    success: true,
    programId: args.programId,
    exists: true,
    health: {
      totalPatterns: patterns.length,
      activePatterns: activePatterns.length,
      stalePatterns: stalePatterns.length,
      promotedPatterns: promotedPatterns.length,
      domains,
      lastUpdatedAt: data.lastUpdatedAt || null,
      lastUpdatedBy: data.lastUpdatedBy || null,
      decay: {
        maxUnpromotedPatterns: data.decay?.maxUnpromotedPatterns || 50,
        learnedPatternMaxAge: data.decay?.learnedPatternMaxAge || 30,
        lastDecayRun: data.decay?.lastDecayRun || null,
      },
    },
    message: `Memory health for "${args.programId}": ${activePatterns.length} active, ${stalePatterns.length} stale, ${promotedPatterns.length} promoted across ${domains.length} domain(s).`,
  });
}

export async function updateProgramStateHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateProgramStateSchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canWrite(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write state for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const existing = await docRef.get();

  const now = new Date().toISOString();
  const base = existing.exists ? existing.data()! : defaultState(args.programId, args.sessionId || "unknown");

  // Build the updated state by merging provided fields
  const updated: Record<string, unknown> = {
    programId: args.programId,
    version: (base.version || 0) + 1,
    lastUpdatedBy: auth.programId === "legacy" || auth.programId === "mobile" ? args.programId : auth.programId,
    lastUpdatedAt: now,
    sessionId: args.sessionId || base.sessionId || "unknown",
  };

  // Merge contextSummary
  if (args.contextSummary) {
    const baseCtx = base.contextSummary || {};
    updated.contextSummary = {
      lastTask: args.contextSummary.lastTask !== undefined ? args.contextSummary.lastTask : baseCtx.lastTask || null,
      activeWorkItems: args.contextSummary.activeWorkItems || baseCtx.activeWorkItems || [],
      handoffNotes: args.contextSummary.handoffNotes !== undefined ? args.contextSummary.handoffNotes : baseCtx.handoffNotes || "",
      openQuestions: args.contextSummary.openQuestions || baseCtx.openQuestions || [],
    };
  } else {
    updated.contextSummary = base.contextSummary;
  }

  // Merge learnedPatterns — replace entirely if provided
  let patterns = args.learnedPatterns || base.learnedPatterns || [];

  // Enforce maxUnpromotedPatterns cap
  const maxUnpromoted = args.decay?.maxUnpromotedPatterns || base.decay?.maxUnpromotedPatterns || 50;
  const unpromoted = patterns.filter((p: any) => !p.promotedToStore);
  if (unpromoted.length > maxUnpromoted) {
    // Sort by confidence ascending, evict lowest
    unpromoted.sort((a: any, b: any) => a.confidence - b.confidence);
    const toEvict = new Set(unpromoted.slice(0, unpromoted.length - maxUnpromoted).map((p: any) => p.id));
    patterns = patterns.filter((p: any) => p.promotedToStore || !toEvict.has(p.id));
  }
  updated.learnedPatterns = patterns;

  // Merge config
  if (args.config) {
    const baseConfig = base.config || {};
    updated.config = {
      preferredOutputFormat: args.config.preferredOutputFormat !== undefined ? args.config.preferredOutputFormat : baseConfig.preferredOutputFormat || null,
      toolPreferences: args.config.toolPreferences || baseConfig.toolPreferences || {},
      knownQuirks: args.config.knownQuirks || baseConfig.knownQuirks || [],
      customSettings: args.config.customSettings || baseConfig.customSettings || {},
    };
  } else {
    updated.config = base.config;
  }

  // Merge baselines
  if (args.baselines) {
    const baseBaselines = base.baselines || {};
    updated.baselines = {
      avgTaskDurationMinutes: args.baselines.avgTaskDurationMinutes !== undefined ? args.baselines.avgTaskDurationMinutes : baseBaselines.avgTaskDurationMinutes || null,
      commonFailureModes: args.baselines.commonFailureModes || baseBaselines.commonFailureModes || [],
      sessionsCompleted: args.baselines.sessionsCompleted !== undefined ? args.baselines.sessionsCompleted : baseBaselines.sessionsCompleted || 0,
      lastSessionDurationMinutes: args.baselines.lastSessionDurationMinutes !== undefined ? args.baselines.lastSessionDurationMinutes : baseBaselines.lastSessionDurationMinutes || null,
    };
  } else {
    updated.baselines = base.baselines;
  }

  // Merge decay
  if (args.decay) {
    const baseDecay = base.decay || {};
    updated.decay = {
      contextSummaryTTLDays: args.decay.contextSummaryTTLDays || baseDecay.contextSummaryTTLDays || 7,
      learnedPatternMaxAge: args.decay.learnedPatternMaxAge || baseDecay.learnedPatternMaxAge || 30,
      maxUnpromotedPatterns: args.decay.maxUnpromotedPatterns || baseDecay.maxUnpromotedPatterns || 50,
      lastDecayRun: baseDecay.lastDecayRun || now,
      decayLog: baseDecay.decayLog || [],
    };
  } else {
    updated.decay = base.decay;
  }

  await docRef.set(updated);

  return jsonResult({
    success: true,
    programId: args.programId,
    patternsCount: (updated.learnedPatterns as any[]).length,
    message: `State updated for "${args.programId}".`,
  });
}

// === Memory-as-Product Phase 1: Additional operations ===

const DeleteMemorySchema = z.object({
  programId: z.string().max(100),
  patternId: z.string(),
});

/**
 * delete_memory — Remove a learned pattern by ID.
 * Hard delete — pattern is removed from the array, not marked stale.
 */
export async function deleteMemoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = DeleteMemorySchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canWrite(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const existing = await docRef.get();

  if (!existing.exists) {
    return jsonResult({ success: false, error: `No memory state for "${args.programId}".` });
  }

  const data = existing.data()!;
  const patterns: any[] = Array.isArray(data.learnedPatterns) ? [...data.learnedPatterns] : [];
  const before = patterns.length;
  const filtered = patterns.filter((p: any) => p.id !== args.patternId);

  if (filtered.length === before) {
    return jsonResult({ success: false, error: `Pattern "${args.patternId}" not found.` });
  }

  const now = new Date().toISOString();
  await docRef.update({
    learnedPatterns: filtered,
    lastUpdatedBy: auth.programId,
    lastUpdatedAt: now,
    version: (data.version || 0) + 1,
  });

  return jsonResult({
    success: true,
    programId: args.programId,
    patternId: args.patternId,
    patternsCount: filtered.length,
    message: `Pattern "${args.patternId}" deleted from "${args.programId}".`,
  });
}

const ReinforceMemorySchema = z.object({
  programId: z.string().max(100),
  patternId: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().max(500).optional(),
});

/**
 * reinforce_memory — Bump an existing pattern's confidence and lastReinforced timestamp.
 * Optionally update confidence score and append evidence.
 * Resets stale flag if pattern was previously stale.
 */
export async function reinforceMemoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = ReinforceMemorySchema.parse(rawArgs);

  if (!isRegisteredProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canWrite(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write memory for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`tenants/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
  const existing = await docRef.get();

  if (!existing.exists) {
    return jsonResult({ success: false, error: `No memory state for "${args.programId}".` });
  }

  const data = existing.data()!;
  const patterns: any[] = Array.isArray(data.learnedPatterns) ? [...data.learnedPatterns] : [];
  const idx = patterns.findIndex((p: any) => p.id === args.patternId);

  if (idx < 0) {
    return jsonResult({ success: false, error: `Pattern "${args.patternId}" not found.` });
  }

  const now = new Date().toISOString();
  const pattern = { ...patterns[idx] };
  pattern.lastReinforced = now;
  if (args.confidence !== undefined) pattern.confidence = args.confidence;
  if (args.evidence) pattern.evidence = args.evidence;
  if (pattern.stale) pattern.stale = false;
  patterns[idx] = pattern;

  await docRef.update({
    learnedPatterns: patterns,
    lastUpdatedBy: auth.programId,
    lastUpdatedAt: now,
    version: (data.version || 0) + 1,
  });

  return jsonResult({
    success: true,
    programId: args.programId,
    patternId: args.patternId,
    confidence: pattern.confidence,
    message: `Pattern "${args.patternId}" reinforced for "${args.programId}".`,
  });
}
