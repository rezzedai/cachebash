/**
 * Relay — Ephemeral inter-program messages with TTL.
 *
 * CacheBash's nervous system. Messages flow through relay,
 * get delivered, and expire. No permanent storage.
 * For durable work, use tasks.
 */

import { FirestoreTimestamp, Envelope } from "./envelope.js";

/** Relay message types — the CacheBash protocol vocabulary */
export type RelayMessageType =
  | "PING"
  | "PONG"
  | "HANDSHAKE"
  | "DIRECTIVE"
  | "STATUS"
  | "ACK"
  | "QUERY"
  | "RESULT";

/** Relay delivery status */
export type RelayStatus = "pending" | "delivered" | "expired" | "dead_letter";

/** The RelayMessage document — lives in users/{uid}/relay/{id} */
export interface RelayMessage extends Omit<Envelope, "action"> {
  id: string;

  message_type: RelayMessageType;
  payload: unknown;
  action: Envelope["action"];

  // Session
  sessionId?: string;

  // Structured payload (optional)
  structuredPayload?: unknown;
  schemaValid?: boolean | null;

  // Delivery
  status: RelayStatus;
  ttl: number;
  expiresAt: FirestoreTimestamp;

  // Delivery tracking
  deliveryAttempts: number;
  maxDeliveryAttempts: number;
  deadLetteredAt?: FirestoreTimestamp;

  // Multicast
  multicastId?: string;
  multicastSource?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  deliveredAt?: FirestoreTimestamp;
}

/** Default TTL for relay messages: 24 hours */
export const RELAY_DEFAULT_TTL_SECONDS = 86400;

/** Default max delivery attempts before dead-lettering */
export const RELAY_MAX_DELIVERY_ATTEMPTS = 3;
