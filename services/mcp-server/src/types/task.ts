/**
 * Task — The unified work unit of CacheBash.
 *
 * Tasks, questions, dreams, sprints, and sprint stories
 * are all the same entity with different `type` discriminators.
 * One collection. One lifecycle. One query surface.
 */

import { FirestoreTimestamp, Envelope } from "./envelope.js";
import type { LifecycleStatus } from "../lifecycle/engine.js";

/** Task type discriminator */
export type TaskType = "task" | "question" | "dream" | "sprint" | "sprint-story";

/** Question sub-object (type == "question") */
export interface QuestionData {
  content: string;
  options?: string[];
  response?: string;
  answeredAt?: FirestoreTimestamp;
}

/** Dream sub-object (type == "dream") */
export interface DreamData {
  agent: string;
  budget_cap_usd: number;
  budget_consumed_usd: number;
  timeout_hours: number;
  branch: string;
  pr_url?: string;
  outcome?: string;
  morning_report?: string;
  created_by: string;
}

/** Sprint configuration */
export interface SprintConfig {
  orchestratorModel?: string;
  subagentModel?: string;
  maxConcurrent?: number;
}

/** Sprint completion summary */
export interface SprintSummary {
  completed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
}

/** Sprint sub-object (type == "sprint" or "sprint-story") */
export interface SprintData {
  parentId?: string;
  projectName?: string;
  branch?: string;
  wave?: number;
  dependencies?: string[];
  complexity?: "normal" | "high";
  config?: SprintConfig;
  currentAction?: string;
  summary?: SprintSummary;
  definition?: Array<{
    id: string;
    title: string;
    wave: number;
    dependencies: string[];
    complexity: string;
    retryPolicy: string;
    maxRetries: number;
  }>;
}

/** State transition log entry (Wave 11) */
export interface StateTransition {
  fromStatus: string;
  toStatus: string;
  timestamp: string;   // ISO 8601 string (NOT Firestore timestamp -- arrays of Timestamps are problematic)
  actor: string;       // programId that caused the transition
  action?: string;     // optional: "claim", "complete", "retry", "abort", "reassign", "escalate", "approve", "replay"
}

/** The Task document — lives in tenants/{uid}/tasks/{id} */
export interface Task extends Envelope {
  id: string;
  type: TaskType;

  // Content
  title: string;
  instructions?: string;
  context?: string;

  // Type-specific data
  question?: QuestionData;
  dream?: DreamData;
  sprint?: SprintData;
  retry?: {
    policy: string;
    maxRetries: number;
    retryCount: number;
    retryHistory: Array<{ attempt: number; failedAt: string }>;
  };

  // GitHub Projects board link
  boardItemId?: string;

  // Lifecycle
  status: LifecycleStatus;
  blockedBy?: string[];

  // Policy mode (Wave 7: Control Plane v2)
  policy_mode?: "normal" | "supervised" | "strict";
  awaitingApproval?: boolean;

  // Lineage tracking (Wave 11)
  replayOf?: string;        // taskId this was replayed from
  retriedFrom?: string;     // taskId this was retried from (in-place retry resets same doc, but record origin)
  reassignedFrom?: string;  // taskId this was reassigned from
  escalatedFrom?: string;   // taskId this was escalated from
  lineageRoot?: string;     // root ancestor taskId (for quick chain queries)

  // State transition log (Wave 11)
  stateTransitions?: StateTransition[];

  // Session tracking
  sessionId?: string;
  projectId?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  startedAt?: FirestoreTimestamp;
  completedAt?: FirestoreTimestamp;
  lastHeartbeat?: FirestoreTimestamp;

  // Metadata
  // Telemetry (v2.2)
  task_class?: "WORK" | "CONTROL";
  completed_status?: "SUCCESS" | "FAILED" | "SKIPPED" | "CANCELLED";
  attempt_count?: number;
  last_error_code?: string;
  last_error_class?: "TRANSIENT" | "PERMANENT" | "DEPENDENCY" | "POLICY" | "TIMEOUT" | "UNKNOWN";
  model?: string;
  provider?: string;

  encrypted: boolean;
  archived: boolean;
  deletedAt?: FirestoreTimestamp;
  preview?: string;
}

// Re-export lifecycle status from the canonical source
export type { LifecycleStatus };
