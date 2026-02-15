/**
 * Ledger Module — Cost tracking per tool call.
 * Collection: users/{uid}/ledger
 * Fire-and-forget writes — never blocks the response.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";

export function logToolCall(
  userId: string,
  tool: string,
  program: string,
  sessionId: string | undefined,
  durationMs: number,
  success: boolean,
  error?: string
): void {
  // Fire and forget — don't await, don't block
  const db = getFirestore();
  db.collection(`users/${userId}/ledger`).add({
    tool,
    program,
    sessionId: sessionId || null,
    timestamp: serverTimestamp(),
    duration_ms: durationMs,
    success,
    error: error || null,
  }).catch((err) => {
    console.error("[Ledger] Failed to log tool call:", err);
  });
}
