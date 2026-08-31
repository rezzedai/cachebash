/**
 * PLAN-W1 — pure classification logic for backfilling `expiresAt` onto task
 * documents that predate the dispatch()/create_task ttl fixes (PLAN-W2/W2b) and
 * have no expiresAt field at all.
 *
 * Deliberately pure and I/O-free: no Firestore, no auth, no service dependencies.
 * This is the shared source of truth for the classification rule, callable both
 * from the read-only dry-run harness (scripts/backfill-task-expiresAt.ts) and from
 * a future service-side execution path — per ISO/VECTOR's ruling, the actual write
 * belongs inside cachebash-mcp under its own runtime service account, not a local
 * script reaching into Firestore with a developer credential. This module is that
 * shared logic; it does not itself write anything.
 *
 * Classifies on expiresAt/status/auto_archived/completedAt/createdAt ONLY. NEVER
 * on `ttl` — after W2/W2b, ttl:0 means never-expires (the never-expires sentinel),
 * so any code treating ttl as a deadline would read 0 as "expired immediately",
 * the same falsy trap PLAN-W2 exists to remove, one layer up and with deletion
 * behind it.
 */

import { CONSTANTS } from "../../config/constants.js";

const REAPABLE_GRACE_DAYS = 7;

export interface BackfillClassification {
  branch: "reapable" | "sentinel";
  expiresAt: Date;
  /** True when the document didn't fit either branch cleanly and fell back to the
   *  safe (sentinel) default -- surfaced separately so it can be reviewed, never
   *  silently absorbed into the count. */
  ambiguous: boolean;
  reason?: string;
}

/** Minimal shape this classifier reads. Deliberately narrow -- it must never touch
 *  `ttl`, and touches nothing it doesn't need to decide the branch. */
export interface ClassifiableTaskData {
  status?: string;
  auto_archived?: boolean;
  completedAt?: FirebaseFirestore.Timestamp;
  createdAt?: FirebaseFirestore.Timestamp;
}

export function classifyForBackfill(data: ClassifiableTaskData): BackfillClassification {
  const isTerminal = data.status === "done" || data.status === "cancelled" || data.auto_archived === true;

  if (!isTerminal) {
    return { branch: "sentinel", expiresAt: new Date(CONSTANTS.ttl.neverExpiresSentinel), ambiguous: false };
  }

  const base = data.completedAt ?? data.createdAt;
  if (base && typeof base.toDate === "function") {
    const expiresAt = new Date(base.toDate().getTime() + REAPABLE_GRACE_DAYS * 24 * 3600 * 1000);
    return { branch: "reapable", expiresAt, ambiguous: false };
  }

  // Terminal but no usable timestamp to date it from -- cannot be dated, so it
  // does not fit the reapable branch cleanly. Fall back to the safe default
  // (over-retaining is recoverable, over-deleting is not) and flag it.
  return {
    branch: "sentinel",
    expiresAt: new Date(CONSTANTS.ttl.neverExpiresSentinel),
    ambiguous: true,
    reason: `terminal (status=${data.status ?? "?"}, auto_archived=${data.auto_archived === true}) but no usable completedAt/createdAt`,
  };
}
