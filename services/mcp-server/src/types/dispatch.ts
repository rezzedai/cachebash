/**
 * Dispatch Types — Request/response contracts for the dispatch() meta-tool.
 *
 * The dispatch tool composes task creation + directive send + uptake verification
 * into a single atomic operation that enforces the Grid dispatch protocol.
 */

import { FirestoreTimestamp } from "./envelope.js";

/** Target program liveness classification */
export type TargetState = "alive" | "stale" | "absent";

/** Wake attempt outcome */
export type WakeResult = "success" | "timeout" | "not_spawnable" | "host_unreachable" | "skipped";

/** Dispatch request — everything needed to dispatch work to a program */
export interface DispatchRequest {
  /** Sending program ID */
  source: string;
  /** Target program ID */
  target: string;
  /** Task title (max 200 chars) */
  title: string;
  /** Full task instructions (max 32000 chars) */
  instructions?: string;
  /** Task priority */
  priority?: "low" | "normal" | "high";
  /** Task action classification */
  action?: "interrupt" | "sprint" | "parallel" | "queue" | "backlog";
  /** Wait for target to claim the task before returning */
  waitForUptake?: boolean;
  /** Seconds to wait for uptake (default: 45) */
  uptakeTimeoutSeconds?: number;
  /** Trigger wake daemon if target is stale/absent */
  autoWake?: boolean;
  /** Optional thread grouping */
  threadId?: string;
  /** Optional project ID */
  projectId?: string;
  /** Agent trace IDs */
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

/** Spawn specification returned on failure for client-side recovery */
export interface SpawnSpec {
  programId: string;
  model: string;
  repo: string;
  description: string;
}

/** Dispatch response — full lifecycle result */
export interface DispatchResponse {
  success: boolean;
  /** Created task ID */
  taskId: string;
  /** Sent directive message ID (null if directive send failed) */
  directiveId: string | null;
  /** Target liveness at dispatch time */
  targetState: TargetState;
  /** Whether the target claimed the task within the timeout */
  uptakeConfirmed: boolean;
  /** Who claimed the task (program ID) */
  claimedBy?: string;
  /** When the task was claimed */
  claimedAt?: string;
  /** Target's heartbeat age as human-readable string */
  heartbeatAge: string;
  /** Whether auto-wake was attempted */
  wakeAttempted?: boolean;
  /** Wake daemon result */
  wakeResult?: WakeResult;
  /** Action required by caller (present on failure) */
  action_required?: "spawn_target" | "retry" | "none";
  /** Spawn spec for client-side recovery (present when action_required = spawn_target) */
  spawnSpec?: SpawnSpec;
  /** Human-readable message */
  message: string;
  /** Governance pre-flight warnings (soft checks, non-blocking) */
  governance_warnings?: string[];
}
