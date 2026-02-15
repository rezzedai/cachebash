/**
 * Ledger Module — Cost tracking per tool call.
 * Collection: users/{uid}/ledger
 * Fire-and-forget writes — never blocks the response.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { FieldValue } from "firebase-admin/firestore";

/** Simple cost heuristic for Phase 2. Refined with real data in Phase 3. */
const BASE_COSTS: Record<string, number> = {
  create_task: 0.001,
  get_tasks: 0.0005,
  claim_task: 0.001,
  complete_task: 0.0005,
  send_message: 0.001,
  get_messages: 0.0005,
  get_dead_letters: 0.0005,
  create_session: 0.001,
  update_session: 0.0005,
  list_sessions: 0.0005,
  ask_question: 0.001,
  get_response: 0.0005,
  send_alert: 0.001,
  dream_peek: 0.0002,
  dream_activate: 0.001,
  create_dream: 0.001,
  kill_dream: 0.001,
  create_sprint: 0.002,
  update_sprint_story: 0.001,
  add_story_to_sprint: 0.001,
  complete_sprint: 0.001,
  create_key: 0.001,
  revoke_key: 0.001,
  list_keys: 0.0005,
  get_audit: 0.0005,
};

function estimateCost(tool: string): number {
  return BASE_COSTS[tool] || 0.001;
}

export function logToolCall(
  userId: string,
  tool: string,
  programId: string,
  endpoint: string,
  sessionId: string | undefined,
  durationMs: number,
  success: boolean,
  error?: string,
  dreamId?: string
): void {
  const cost = estimateCost(tool);

  // Fire and forget — don't await, don't block
  const db = getFirestore();
  db.collection(`users/${userId}/ledger`).add({
    tool,
    programId,
    endpoint,
    sessionId: sessionId || null,
    estimated_cost_usd: cost,
    timestamp: serverTimestamp(),
    duration_ms: durationMs,
    success,
    error: error || null,
    dreamId: dreamId || null,
  }).catch((err) => {
    console.error("[Ledger] Failed to log tool call:", err);
  });

  // Update dream budget if applicable
  if (dreamId && success) {
    updateDreamBudget(userId, dreamId, cost);
  }
}

/**
 * Update dream budget consumption.
 * Fire-and-forget, called automatically by logToolCall.
 */
export function updateDreamBudget(
  userId: string,
  dreamId: string,
  cost: number,
): void {
  if (!dreamId || cost <= 0) return;
  const db = getFirestore();
  db.doc(`users/${userId}/tasks/${dreamId}`).update({
    "dream.budget_consumed_usd": FieldValue.increment(cost),
  }).catch((err) => {
    console.error("[Ledger] Failed to update dream budget:", err);
  });
}
