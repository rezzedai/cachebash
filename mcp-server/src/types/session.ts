/**
 * Session — Program lifecycle tracking.
 *
 * Every program in CacheBash has a session. Sessions track
 * what a program is doing, its health, and its lifecycle state.
 */

import { FirestoreTimestamp } from "./envelope.js";
import type { LifecycleStatus } from "../lifecycle/engine.js";

export interface ComplianceState {
  state: "UNREGISTERED" | "BOOTING" | "COMPLIANT" | "WARNED" | "DEGRADED" | "DEREZZING" | "DEREZED";
  boot: {
    gotProgramState: boolean;
    gotTasks: boolean;
    gotMessages: boolean;
    bootCompletedAt?: string;
  };
  journal: {
    toolCallsSinceLastJournal: number;
    lastJournalAt?: string;
    lastJournalToolCall?: number;
    totalToolCalls: number;
    journalActivated: boolean;
  };
  stateChangedAt: string;
  stateHistory: Array<{ from: string; to: string; trigger: string; at: string }>;
}

/** The Session document — lives in tenants/{uid}/sessions/{id} */
export interface Session {
  id: string;
  programId?: string;

  // Lifecycle
  status: LifecycleStatus;

  // State
  name: string;
  progress?: number;
  currentAction?: string;
  projectName?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  lastUpdate: FirestoreTimestamp;
  endedAt?: FirestoreTimestamp;
  lastHeartbeat?: FirestoreTimestamp;

  // Metadata
  archived: boolean;
  archivedAt?: FirestoreTimestamp;
  model?: string;

  // Context Health (Phase 4)
  contextBytes?: number;
  handoffRequired?: boolean;

  // Advisory session compliance state (fail-open)
  compliance?: ComplianceState;
}
