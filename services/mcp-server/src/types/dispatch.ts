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

/** Durable dispatch obligation state */
export type DispatchDeliveryState =
  | "stored"
  | "wake-attempted"
  | "notified"
  | "claimed"
  | "rejected"
  | "escalated"
  | "expired";

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
  /** Optional idempotency key preventing duplicate dispatch obligations/work */
  idempotency_key?: string;
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
  /** Durable obligation ID for uptake tracking */
  obligationId: string;
  /** Current durable delivery state */
  deliveryState: DispatchDeliveryState;
  /** True when this response reused an existing idempotent obligation */
  idempotent?: boolean;
  /** Handle returned whenever dispatch has not yet reached claim/ACK uptake */
  pendingHandle?: {
    obligationId: string;
    taskId: string;
    directiveId: string | null;
    deliveryState: DispatchDeliveryState;
    claimSlaSeconds: number;
  };
  /** Target liveness at dispatch time */
  targetState: TargetState;
  /** Whether the target claimed the task within the timeout */
  uptakeConfirmed: boolean;
  /** How uptake was confirmed */
  uptakeVia?: "claim" | "ack";
  /** Who claimed the task (program ID) */
  claimedBy?: string;
  /** When the task was claimed */
  claimedAt?: string;
  /** ACK relay ID when uptake was confirmed by DIRECTIVE ACK */
  ackId?: string;
  /** ACK timestamp when uptake was confirmed by DIRECTIVE ACK */
  ackAt?: string;
  /** Target's heartbeat age as human-readable string */
  heartbeatAge: string;
  /** Whether auto-wake was attempted */
  wakeAttempted?: boolean;
  /** Wake daemon result */
  wakeResult?: WakeResult;
  /** Action required by caller (present on failure) */
  action_required?: "spawn_target" | "retry" | "monitor_pending" | "none" | "unquarantine";
  /** Spawn spec for client-side recovery (present when action_required = spawn_target) */
  spawnSpec?: SpawnSpec;
  /** Human-readable message */
  message: string;
  /** Governance pre-flight warnings (soft checks, non-blocking) */
  governance_warnings?: string[];
  /** Policy violations detected during dispatch */
  policy_violations?: Array<{
    policyId: string;
    policyName: string;
    enforcement: string;
    severity: string;
    message: string;
  }>;
  /** Wave 16: Suggested alternative target with better historical success rate (advisory only) */
  suggested_target?: string;
  /** Wave 16: Reason for target suggestion */
  suggestion_reason?: string;
}
