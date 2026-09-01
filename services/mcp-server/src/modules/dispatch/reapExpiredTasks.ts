/**
 * PLAN-W4 — THE REAPER. Deletes task documents whose expiresAt has passed.
 *
 * Same service-side scaffolding as PLAN-W1's backfillExpiresAt.ts, deliberately:
 * paginate the tenant's tasks collection by document id (Firestore has no
 * "field does not exist" query, and an id-ordered scan needs no composite
 * index), classify each doc client-side, batch the resulting writes at <=400
 * (Firestore's 500 cap; PR #397 is the precedent), dry-run by default, runs
 * under whatever credential the running service process has (the Cloud Run
 * runtime SA in production, per VECTOR's ruling -- see
 * expiresAtBackfillClassifier.ts, PR #406). grid-deployer's write grant will
 * not be restored for this either.
 *
 * DELETION PREDICATE (exact, nothing looser): expiresAt EXISTS AND
 * expiresAt <= now. A doc with no expiresAt field is counted separately
 * (fieldLessCount) and is NEVER a delete candidate -- W4-R1, blocking, and
 * structural here: the branch that would delete is only reachable after the
 * `data.expiresAt === undefined` branch has already `continue`d past it.
 * Keys off expiresAt ONLY, never ttl -- ttl:0 means never-expires (PLAN-W2's
 * sentinel encoding); anything reading ttl as a deadline sees 0 and treats it
 * as expired-immediately, which is exactly the set the sentinel exists to
 * protect. This module never reads ttl.
 *
 * Idempotent and resumable by document id: a doc, once deleted, simply no
 * longer appears in the scan. There is no cursor to persist across calls.
 */

import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirestore } from "../../firebase/client.js";
import type { AuthContext } from "../../auth/authValidator.js";

const PAGE_SIZE = 1000;
// Firestore's 500-writes-per-batch cap; PR #397 is the precedent -- one
// unbounded batch failed wholesale and deleted nothing. Not caller-tunable.
const BATCH_WRITE_MAX = 400;

// Same "admin/orchestrator only" gate as backfillExpiresAt.ts / gsp.ts's
// gspSeedHandler -- a bulk delete across the tenant's tasks collection is not
// something an ordinary tenant role should be able to trigger.
const AUTHORIZED_PROGRAMS = ["basher", "iso", "vector"];

const ReapSchema = z.object({
  execute: z.boolean().default(false),
  // Narrows the delete candidates to one `source` value, for a staged rollout
  // (PLAN-W4.3: one narrow cohort first, re-measure, then widen). Omitted =
  // every expired doc is a candidate. Dry-run always reports the full,
  // un-narrowed breakdown (bySource) regardless of this filter, so the caller
  // can see the true cohort size before committing to one.
  cohortSource: z.string().max(100).optional(),
  // Caps how many delete candidates this call processes, independent of
  // cohortSource -- lets a cohort itself be staged in slices.
  limit: z.number().int().positive().max(50000).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function reapExpiredTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const hasWildcard = auth.capabilities.includes("*");
  if (!AUTHORIZED_PROGRAMS.includes(auth.programId) && !hasWildcard) {
    return jsonResult({
      success: false,
      error: "UNAUTHORIZED",
      message: `dispatch_reap_expired_tasks requires a fleet-internal role. Current programId: ${auth.programId}`,
    });
  }

  const args = ReapSchema.parse(rawArgs);
  const db = getFirestore();
  const col = db.collection(`tenants/${auth.userId}/tasks`);
  const nowMs = Date.now();

  let scanned = 0;
  let fieldLessCount = 0;
  let liveWithExpiry = 0;
  let expiredCandidates = 0;
  const bySource: Record<string, number> = {};
  const deletedIds: string[] = [];

  let batch = args.execute ? db.batch() : null;
  let pendingWrites = 0;
  let lastDoc: QueryDocumentSnapshot | null = null;

  scan: for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();

      // W4-R1, blocking: a field-less doc is NEVER a delete candidate. This
      // branch returns before the doc is ever considered for deletion below --
      // structural exclusion, not just an assertion.
      if (data.expiresAt === undefined) {
        fieldLessCount++;
        continue;
      }

      const expiresAtMs: number = data.expiresAt.toMillis
        ? data.expiresAt.toMillis()
        : new Date(data.expiresAt).getTime();
      if (expiresAtMs > nowMs) {
        liveWithExpiry++;
        continue;
      }

      // Expired -- a delete candidate, before any cohort narrowing.
      const src = (data.source as string) ?? "(none)";
      bySource[src] = (bySource[src] || 0) + 1;

      if (args.cohortSource && src !== args.cohortSource) continue; // outside this stage's cohort

      expiredCandidates++;

      if (args.execute) {
        batch!.delete(doc.ref);
        pendingWrites++;
        deletedIds.push(doc.id);
        if (pendingWrites >= BATCH_WRITE_MAX) {
          await batch!.commit();
          batch = db.batch();
          pendingWrites = 0;
        }
      }

      const countedSoFar = args.execute ? deletedIds.length : expiredCandidates;
      if (args.limit && countedSoFar >= args.limit) break scan;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  if (args.execute && pendingWrites > 0) {
    await batch!.commit();
  }

  return jsonResult({
    success: true,
    mode: args.execute ? "EXECUTE" : "DRY-RUN",
    cohortSource: args.cohortSource ?? null,
    scanned,
    fieldLessCount,
    liveWithExpiry,
    expiredCandidates,
    bySource,
    deletedCount: deletedIds.length,
    deletedIdsSample: deletedIds.slice(0, 20),
    limited: args.limit !== undefined,
  });
}
