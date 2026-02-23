/**
 * Events Module — Append-only event stream for telemetry.
 * All events are fire-and-forget. Never blocks callers.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as crypto from "crypto";

export type EventType =
  | "TASK_CREATED"
  | "TASK_CLAIMED"
  | "TASK_SUCCEEDED"
  | "TASK_FAILED"
  | "TASK_RETRIED"
  | "RELAY_DELIVERED"
  | "TASK_RETRY_EXHAUSTED"
  | "RELAY_DEAD_LETTERED"
  | "GUARDIAN_CHECK"
  | "SUBAGENT_SPAWNED"
  | "PR_OPENED"
  | "PR_MERGED"
  | "CLEANUP_RUN"
  | "SESSION_DEATH"
  | "SESSION_ENDED"
  | "PROGRAM_WAKE"
  | "STATE_DECAY"
  | "BUDGET_EXCEEDED"
  | "BUDGET_WARNING";
export type TaskClass = "WORK" | "CONTROL";

export type CompletedStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "CANCELLED";

export type ErrorClass = "TRANSIENT" | "PERMANENT" | "DEPENDENCY" | "POLICY" | "TIMEOUT" | "UNKNOWN";

export type DeadLetterReason = "EXPIRED_TTL" | "TARGET_OFFLINE" | "NO_HEARTBEAT" | "SCHEMA_REJECTED" | "PERMISSION_DENIED";

export type GuardianDecision = "ALLOW" | "BLOCK";

export type GuardianReasonClass = "DESTRUCTIVE_OP" | "CREDENTIAL" | "BUDGET" | "RATE_LIMIT" | "SOURCE_MISMATCH" | "UNKNOWN";

export interface EventData {
  event_type: EventType;
  program_id?: string;
  session_id?: string;
  task_id?: string;
  task_class?: TaskClass;
  prompt_hash?: string;
  output_hash?: string;
  config_hash?: string;
  [key: string]: unknown;
}

/**
 * Compute SHA-256 hash of a string for provenance tracking.
 * Used to create tamper-evident traces of prompts and outputs.
 */
export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Emit an event to the append-only events stream.
 * Fire-and-forget — never blocks the caller, never throws.
 */
export function emitEvent(userId: string, data: EventData): void {
  try {
    const db = getFirestore();
    db.collection(`users/${userId}/events`).add({
      ...data,
      timestamp: serverTimestamp(),
    }).catch((err) => {
      console.error("[Events] Failed to write event:", err);
    });
  } catch (err) {
    console.error("[Events] Failed to emit event:", err);
  }
}

/**
 * Classify task type into task_class (WORK vs CONTROL).
 * WORK = substantive work that produces deliverables.
 * CONTROL = coordination overhead (ACKs, handoffs, system signals).
 */
export function classifyTask(type: string, action: string, title: string): TaskClass {
  // Sprint stories are always WORK
  if (type === "sprint-story") return "WORK";
  
  // Sprints (parent) are CONTROL (coordination)
  if (type === "sprint") return "CONTROL";
  
  // Dreams are WORK
  if (type === "dream") return "WORK";
  
  // Questions are CONTROL (decision-making coordination)
  if (type === "question") return "CONTROL";
  
  // For regular tasks, classify by title patterns and action
  const titleLower = title.toLowerCase();
  
  // ACK, HANDOFF, STATUS, DIRECTIVE patterns → CONTROL
  if (titleLower.includes("] ack") || titleLower.includes("] status")) return "CONTROL";
  if (titleLower.includes("handoff") || titleLower.includes("context_cycle")) return "CONTROL";
  
  // RESULT patterns → WORK (they report completed deliverables)
  if (titleLower.includes("] result")) return "WORK";
  
  // Interrupt actions are WORK (urgent work)
  if (action === "interrupt") return "WORK";
  
  // Sprint actions are WORK
  if (action === "sprint") return "WORK";
  
  // Default: WORK
  return "WORK";
}
