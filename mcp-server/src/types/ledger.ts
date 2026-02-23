/**
 * Ledger — Cost tracking per tool call.
 *
 * Every tool invocation in CacheBash gets a ledger entry.
 * Fire-and-forget writes — never blocks the response.
 */

import { FirestoreTimestamp } from "./envelope.js";

/** The LedgerEntry document — lives in users/{uid}/ledger/{id} */
export interface LedgerEntry {
  id: string;

  // What happened
  tool: string;
  program: string;
  sessionId?: string;

  // Cost
  estimated_cost_usd?: number;
  tokens_used?: number;
  model?: string;

  // Timing
  timestamp: FirestoreTimestamp;
  duration_ms?: number;

  // Context
  action?: string;
  success: boolean;
  error?: string;
}
