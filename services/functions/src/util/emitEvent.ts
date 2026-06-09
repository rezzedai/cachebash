import * as admin from "firebase-admin";

/**
 * Cloud-Functions-side telemetry emitter.
 *
 * Mirrors the mcp-server append-only event stream (services/mcp-server/src/modules/events.ts):
 * writes to `tenants/{userId}/events` with an `event_type` discriminator and a
 * server timestamp. Fire-and-forget — never blocks the trigger, never throws.
 *
 * The functions package cannot import the mcp-server `emitEvent` helper (separate
 * package / Firestore client), so this is the functions-local equivalent.
 */
export type FunctionEventType =
  | "PATTERN_PROMOTED"
  | "STATE_DECAY";

export interface FunctionEventData {
  event_type: FunctionEventType;
  program_id?: string;
  [key: string]: unknown;
}

/**
 * Emit a telemetry event to the append-only events stream for a tenant.
 * Fire-and-forget: returns immediately; logs but never rethrows on failure.
 */
export function emitEvent(
  db: admin.firestore.Firestore,
  userId: string,
  data: FunctionEventData
): void {
  try {
    // Strip undefined values — Firestore rejects them.
    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    db.collection(`tenants/${userId}/events`)
      .add({
        ...cleaned,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((err) => {
        console.error("[Events] Failed to write event:", err);
      });
  } catch (err) {
    console.error("[Events] Failed to emit event:", err);
  }
}
