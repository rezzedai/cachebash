/**
 * Session — Program lifecycle tracking.
 *
 * Every program on the Grid has a session. Sessions track
 * what a program is doing, its health, and its lifecycle state.
 */

import { FirestoreTimestamp } from "./envelope.js";
import type { LifecycleStatus } from "../lifecycle/engine.js";

/** The Session document — lives in users/{uid}/sessions/{id} */
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
}
