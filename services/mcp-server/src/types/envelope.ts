/**
 * Envelope v2.2 — Shared fields for all CacheBash entities.
 *
 * Every task, relay message, and inter-program communication
 * carries an envelope. This is CacheBash's addressing system.
 */

import { Timestamp } from "firebase-admin/firestore";

/** Program identity — who sent this, who receives it */
export type ProgramId = string;

/** Priority levels for routing decisions */
export type Priority = "low" | "normal" | "high";

/** Action levels — how urgently the target should handle this */
export type Action = "interrupt" | "sprint" | "parallel" | "queue" | "backlog";

/** Provenance — where this came from and what it cost */
export interface Provenance {
  model?: string;
  cost_tokens?: number;
  confidence?: number;
}

/** The envelope fields shared across entity types */
export interface Envelope {
  source: ProgramId;
  target: ProgramId;
  priority: Priority;
  action: Action;

  /** Schema version — v2.1 = pre-Phase 4, v2.2 = Phase 4+ with schema versioning */
  schemaVersion?: '2.1' | '2.2';

  /** Seconds until expiry (null = no expiry) */
  ttl?: number | null;

  /** Entity ID this responds to */
  replyTo?: string;

  /** Conversation thread grouping */
  threadId?: string;

  /** Origin tracking */
  provenance?: Provenance;

  /** Ordered fallback targets if primary is unreachable */
  fallback?: string[];

  /** Agent Trace L1 — correlation across task/relay/ledger boundaries */
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

/** Firestore timestamp type alias for cleaner signatures */
export type FirestoreTimestamp = Timestamp;
