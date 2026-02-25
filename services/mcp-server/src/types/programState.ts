/**
 * Program State Schema — Persistent operational memory for programs.
 * Collection: tenants/{uid}/sessions/_meta/program_state/{programId}
 */

export interface LearnedPattern {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
  discoveredAt: string;
  lastReinforced: string;
  promotedToStore: boolean;
  stale: boolean;
}

export interface DecayLogEntry {
  timestamp: string;
  action: "context_cleared" | "pattern_staled" | "pattern_evicted" | "baselines_reset";
  detail: string;
}

export interface ProgramState {
  programId: string;
  version: number;

  // Provenance
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  sessionId: string;

  // Context Summary
  contextSummary: {
    lastTask: {
      taskId: string;
      title: string;
      outcome: "completed" | "in_progress" | "blocked" | "deferred";
      notes: string;
    } | null;
    activeWorkItems: string[];
    handoffNotes: string;
    openQuestions: string[];
  };

  // Learned Patterns
  learnedPatterns: LearnedPattern[];

  // Configuration
  config: {
    preferredOutputFormat: string | null;
    toolPreferences: Record<string, string>;
    knownQuirks: string[];
    customSettings: Record<string, unknown>;
  };

  // Performance Baselines
  baselines: {
    avgTaskDurationMinutes: number | null;
    commonFailureModes: string[];
    sessionsCompleted: number;
    lastSessionDurationMinutes: number | null;
  };

  // Decay Metadata
  decay: {
    contextSummaryTTLDays: number;
    learnedPatternMaxAge: number;
    maxUnpromotedPatterns: number;
    lastDecayRun: string;
    decayLog: DecayLogEntry[];
  };
}
