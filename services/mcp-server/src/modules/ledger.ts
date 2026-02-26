/**
 * Ledger Module — Cost tracking per tool call. Type discriminator: tool_call.
 * Collection: tenants/{uid}/ledger
 * Fire-and-forget writes — never blocks the response.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";

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
  create_sprint: 0.002,
  update_sprint_story: 0.001,
  add_story_to_sprint: 0.001,
  complete_sprint: 0.001,
  create_key: 0.001,
  revoke_key: 0.001,
  rotate_key: 0.001,
  list_keys: 0.0005,
  get_audit: 0.0005,
  get_program_state: 0.0005,
  update_program_state: 0.001,
  get_cost_summary: 0.001,
  get_sent_messages: 0.0005,
  get_comms_metrics: 0.001,
  get_fleet_health: 0.001,
  query_message_history: 0.001,
  query_traces: 0.001,
  get_sprint: 0.001,
  list_groups: 0.0002,
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
  error?: string
): void {
  // Fire and forget — don't await, don't block
  const db = getFirestore();
  db.collection(`tenants/${userId}/ledger`).add({
    type: "tool_call",
    tool,
    programId,
    endpoint,
    sessionId: sessionId || null,
    estimated_cost_usd: estimateCost(tool),
    timestamp: serverTimestamp(),
    duration_ms: durationMs,
    success,
    error: error || null,
  }).catch((err) => {
    console.error("[Ledger] Failed to log tool call:", err);
  });
}
