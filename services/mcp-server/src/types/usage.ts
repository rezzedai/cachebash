/**
 * Usage Tracking Types
 * W1.1.4 & W1.1.5: Usage ledger and aggregates
 */

import { FirestoreTimestamp } from "./envelope.js";

/**
 * Immutable ledger entry written on task completion
 * Collection: tenants/{userId}/usage_ledger
 */
export interface UsageLedgerEntry {
  taskId: string;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  completedAt: FirestoreTimestamp;
  programId: string;
  taskType: string;
  completed_status: "SUCCESS" | "FAILED" | "SKIPPED" | "CANCELLED";
}

/**
 * Pre-computed usage rollup by period
 * Collection: tenants/{userId}/usage_aggregates
 */
export interface UsageAggregate {
  period: string; // ISO date string for period start (hour/day/month)
  periodType: "hour" | "day" | "month";
  programId: string;
  model: string;
  taskType: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  taskCount: number;
  successCount: number;
  failedCount: number;
  lastUpdated: FirestoreTimestamp;
}

/**
 * Metadata tracking last aggregation run
 * Document: tenants/{userId}/usage_metadata/last_aggregation
 */
export interface UsageAggregationMetadata {
  timestamp: FirestoreTimestamp; // Last processed entry timestamp
  lastRun: FirestoreTimestamp; // When aggregation last ran
  entriesProcessed: number; // Number of entries processed in last run
}
