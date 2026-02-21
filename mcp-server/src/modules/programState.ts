/**
 * Program State Module — Persistent operational memory for Grid programs.
 * Collection: users/{uid}/sessions/_meta/program_state/{programId}
 */

import { getFirestore } from "../firebase/client.js";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { isGridProgram } from "../config/programs.js";
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
 * - SARK can read any program's state (audit)
 * - ISO/Flynn (legacy/mobile) can read any program's state
 */
function canRead(auth: AuthContext, targetProgramId: string): boolean {
  if (auth.programId === "legacy" || auth.programId === "mobile") return true;
  if (auth.programId === "iso" || auth.programId === "sark") return true;
  return auth.programId === targetProgramId;
}

/**
 * Access control:
 * - Programs can only write their own state
 * - Legacy/mobile (Flynn) can write any state
 */
function canWrite(auth: AuthContext, targetProgramId: string): boolean {
  if (auth.programId === "legacy" || auth.programId === "mobile") return true;
  return auth.programId === targetProgramId;
}

export async function getProgramStateHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = GetProgramStateSchema.parse(rawArgs);

  if (!isGridProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canRead(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot read state for "${args.programId}"` });
  }

  const db = getFirestore();
  const doc = await db.doc(`users/${auth.userId}/sessions/_meta/program_state/${args.programId}`).get();

  if (!doc.exists) {
    return jsonResult({
      success: true,
      exists: false,
      state: defaultState(args.programId, "none"),
      message: `No persisted state for "${args.programId}". Returning defaults.`,
    });
  }

  const data = doc.data()!;

  return jsonResult({
    success: true,
    exists: true,
    state: data,
    message: `State loaded for "${args.programId}".`,
  });
}

export async function updateProgramStateHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateProgramStateSchema.parse(rawArgs);

  if (!isGridProgram(args.programId)) {
    return jsonResult({ success: false, error: `Unknown program: "${args.programId}"` });
  }

  if (!canWrite(auth, args.programId)) {
    return jsonResult({ success: false, error: `Access denied: "${auth.programId}" cannot write state for "${args.programId}"` });
  }

  const db = getFirestore();
  const docRef = db.doc(`users/${auth.userId}/sessions/_meta/program_state/${args.programId}`);
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
