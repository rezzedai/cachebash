/**
 * Relay — Ephemeral inter-program messages with TTL.
 *
 * The Grid's nervous system. Messages flow through relay,
 * get delivered, and expire. No permanent storage.
 * For durable work, use tasks.
 */

import { FirestoreTimestamp, Envelope } from "./envelope.js";

/** Relay message types — the Grid protocol vocabulary */
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
export type RelayStatus = "pending" | "delivered" | "expired";

/** The RelayMessage document — lives in users/{uid}/relay/{id} */
export interface RelayMessage extends Omit<Envelope, "action"> {
  id: string;

  message_type: RelayMessageType;
  payload: unknown;
  action: Envelope["action"];

  // Session
  sessionId?: string;

  // Delivery
  status: RelayStatus;
  ttl: number;
  expiresAt: FirestoreTimestamp;

  // Timestamps
  createdAt: FirestoreTimestamp;
  deliveredAt?: FirestoreTimestamp;
}

/** Default TTL for relay messages: 24 hours */
export const RELAY_DEFAULT_TTL_SECONDS = 86400;
