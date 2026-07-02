/**
 * Usage Counter Middleware — Per-month usage tracking with fire-and-forget increments.
 *
 * Tracks task creation, session starts, message sends, and total tool calls per user per month.
 * Increment operations are fire-and-forget to avoid blocking the hot path.
 */

import { getFirestore } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";

export type UsageField = "tasks_created" | "sessions_started" | "messages_sent" | "total_tool_calls";

export interface UsageCounters {
  tasks_created: number;
  sessions_started: number;
  messages_sent: number;
  total_tool_calls: number;
}

/**
 * Returns current month in YYYY-MM format.
 * Example: "2026-02"
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Fire-and-forget increment of a usage counter.
 * MUST NOT be awaited in the hot path — the write runs in the background.
 *
 * Uses FieldValue.increment(1) with merge: true to create the doc if it doesn't exist.
 * Errors are caught silently and logged to console.
 *
 * @param userId - The user ID (tenant ID)
 * @param field - The counter field to increment
 */
export function incrementUsage(userId: string, field: UsageField): void {
  const db = getFirestore();
  const period = getCurrentPeriod();
  const docRef = db.doc(`tenants/${userId}/usage/${period}`);

  docRef.set(
    { [field]: FieldValue.increment(1) },
    { merge: true }
  ).catch((err) => {
    console.error("[Usage] Increment failed:", { userId, field, period, error: err.message });
  });
}

/**
 * WS-2: fire-and-forget increment of a per-seat usage counter.
 * Mirrors incrementUsage but writes to a `seats.{seatId}.{field}` map field on
 * the SAME tenant usage doc — map form (not a subcollection) so a seat's usage
 * reads in the same get() as the tenant total, at the cost of doc-size growth
 * that's bounded by seat count per tenant (small — seats are provisioned, not
 * user-generated at scale).
 *
 * MUST NOT be awaited in the hot path. Never throws into the caller.
 */
export function incrementSeatUsage(userId: string, seatId: string, field: UsageField): void {
  const db = getFirestore();
  const period = getCurrentPeriod();
  const docRef = db.doc(`tenants/${userId}/usage/${period}`);

  docRef.set(
    { seats: { [seatId]: { [field]: FieldValue.increment(1) } } },
    { merge: true }
  ).catch((err) => {
    console.error("[Usage] Seat increment failed:", { userId, seatId, field, period, error: err.message });
  });
}

/**
 * Reads current month's usage counters for a user.
 * Returns zero counts if the document doesn't exist.
 *
 * @param userId - The user ID (tenant ID)
 * @returns Promise resolving to usage counters
 */
export async function getUsage(userId: string): Promise<UsageCounters> {
  const db = getFirestore();
  const period = getCurrentPeriod();
  const docRef = db.doc(`tenants/${userId}/usage/${period}`);

  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return {
      tasks_created: 0,
      sessions_started: 0,
      messages_sent: 0,
      total_tool_calls: 0,
    };
  }

  const data = snapshot.data() || {};

  return {
    tasks_created: data.tasks_created || 0,
    sessions_started: data.sessions_started || 0,
    messages_sent: data.messages_sent || 0,
    total_tool_calls: data.total_tool_calls || 0,
  };
}
