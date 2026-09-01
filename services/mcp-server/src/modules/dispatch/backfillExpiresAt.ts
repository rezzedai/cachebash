/**
 * PLAN-W1 EXECUTE — service-side backfill of `expiresAt` onto task documents
 * that predate the dispatch()/create_task/signal.ts/wake-daemon.ts/sprint.ts/
 * schedule-executor.ts ttl fixes (PLAN-W2/W2b/W2c/W2d/W2e) and have no
 * expiresAt field at all.
 *
 * Per VECTOR's ruling (see expiresAtBackfillClassifier.ts, PR #406): this write
 * runs INSIDE cachebash-mcp under its own Cloud Run runtime service account,
 * not a local script with a developer credential. grid-deployer's write grant
 * (roles/datastore.owner) will not be restored for this. This handler is that
 * execute path -- it inherits whatever credential the running service process
 * has (the Cloud Run runtime SA in production) via the shared getFirestore().
 *
 * Reuses classifyForBackfill() as-is -- this module only adds the write path,
 * it does not re-derive or "improve" the classification rule.
 *
 * Dry-run by default (execute:false). Idempotent and resumable by document id,
 * not offset: every write only ever touches a doc with NO expiresAt field
 * (`data.expiresAt !== undefined` is filtered out before it's ever a write
 * candidate), and only ever sets that one field via `.update()`, so a doc that
 * already has expiresAt -- whether from a prior run of this same handler, from
 * create_task, or from anything else -- is never touched. Re-running finds
 * strictly fewer (ideally zero) candidates each time; there is no separate
 * cursor to persist across calls.
 */

import { FieldPath, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirestore } from "../../firebase/client.js";
import type { AuthContext } from "../../auth/authValidator.js";
import { classifyForBackfill, type ClassifiableTaskData } from "./expiresAtBackfillClassifier.js";

const PAGE_SIZE = 1000;
// Firestore's 500-writes-per-batch cap; PR #397 is the precedent -- one
// unbounded batch failed wholesale and deleted nothing. Not caller-tunable.
const BATCH_WRITE_MAX = 400;

// Fleet-internal programs this plan is scoped to, plus anything holding the
// wildcard capability. Same "admin/orchestrator only" gate shape as
// gsp.ts's gspSeedHandler -- a bulk write across the whole tenant's tasks
// collection is not something an ordinary tenant role should be able to
// trigger, even though it is additive-only.
const AUTHORIZED_PROGRAMS = ["basher", "iso", "vector"];

const BackfillSchema = z.object({
  execute: z.boolean().default(false),
  // Caps how many field-less docs this single call will classify (dry-run) or
  // write (execute) -- lets the caller stage the rollout (a small first batch,
  // verify, then the remainder) without needing a persisted cursor. Omitted =
  // no cap, sweep everything the scan finds.
  limit: z.number().int().positive().max(20000).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function backfillTaskExpiresAtHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const hasWildcard = auth.capabilities.includes("*");
  if (!AUTHORIZED_PROGRAMS.includes(auth.programId) && !hasWildcard) {
    return jsonResult({
      success: false,
      error: "UNAUTHORIZED",
      message: `dispatch_backfill_task_expires_at requires a fleet-internal role. Current programId: ${auth.programId}`,
    });
  }

  const args = BackfillSchema.parse(rawArgs);
  const db = getFirestore();
  const col = db.collection(`tenants/${auth.userId}/tasks`);

  let scanned = 0;
  let fieldLessFound = 0;
  const split = { reapable: 0, sentinel: 0 };
  let ambiguousCount = 0;
  const ambiguousSample: Array<{ id: string; reason?: string }> = [];
  const writtenIds: string[] = [];

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
      const data = doc.data() as ClassifiableTaskData & { expiresAt?: unknown };
      if (data.expiresAt !== undefined) continue; // has the field -- never our population, never overwritten

      fieldLessFound++;
      const classification = classifyForBackfill(data);
      split[classification.branch]++;
      if (classification.ambiguous) {
        ambiguousCount++;
        if (ambiguousSample.length < 20) {
          ambiguousSample.push({ id: doc.id, reason: classification.reason });
        }
      }

      if (args.execute) {
        batch!.update(doc.ref, { expiresAt: Timestamp.fromDate(classification.expiresAt) });
        pendingWrites++;
        writtenIds.push(doc.id);
        if (pendingWrites >= BATCH_WRITE_MAX) {
          await batch!.commit();
          batch = db.batch();
          pendingWrites = 0;
        }
      }

      const countedSoFar = args.execute ? writtenIds.length : fieldLessFound;
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
    scanned,
    fieldLessFound,
    split,
    ambiguousCount,
    ambiguousSample,
    writtenCount: writtenIds.length,
    writtenIdsSample: writtenIds.slice(0, 20),
    limited: args.limit !== undefined,
  });
}
