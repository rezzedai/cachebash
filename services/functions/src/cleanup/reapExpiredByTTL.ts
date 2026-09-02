/**
 * TTL Reaper — Auto-expire tasks, relay messages, and proposals past their TTL.
 * Runs every 15 minutes.
 *
 * Tasks: DELETE (the pile must actually shrink — see PLAN-W4.2 D2).
 * Relay: Set status=expired, add expiredAt timestamp (unchanged — no growth problem).
 * Proposals: Set status=expired (frees proposer quota, preserves audit trail).
 *
 * Collection group queries for scalability. Each collection is reaped in its
 * own isolated try/catch (PLAN-W4.2 D3): a failure in one (e.g. a missing
 * index) must never prevent the other two from running. Previously all three
 * shared one try block — the tasks query threw FAILED_PRECONDITION first and
 * the catch rethrew, so relay and proposal expiry silently never ran either,
 * since 2026-06-09.
 *
 * Throughput (PLAN-W4.2 D4, CORRECTED — see ISO msg N5or2hLQ2heERM9qRzvf):
 * measured steady-state ingestion is ~236 docs/day (pinned-readTime count()
 * on createdAt, 24h window) — the originally-cited ~115,000/day was an
 * unmeasured error (conflated with an unrelated read-rate figure) and this
 * reaper is NOT racing an ingestion stream. The 148k pile it's cleaning up
 * was a one-time historical burst (2026-03/04), not a trickle.
 *
 * So sizing is NOT "beat ingestion" — it's backlog-drain-time and future-
 * burst tolerance: MAX_PAGE_SIZE(400) * MAX_PAGES_PER_COLLECTION(5) = up to
 * 2,000 docs/collection/run, * 96 runs/day (every 15 min) = up to 192,000/day
 * capacity per collection — enough to drain a burst on the scale of the one
 * that actually happened (~138,510 docs) in well under a day of recurring
 * runs, without being sized against a number nobody measured. Each page's
 * batch commits immediately (see reapPaginated below), so a mid-run timeout
 * leaves prior pages' deletes durably committed rather than losing progress
 * — the precedent this avoids is cleanupExpiredSessions failing wholesale on
 * Firestore's 500-write cap and therefore deleting nothing, so its own
 * backlog kept it permanently broken (PR #397). Batches here stay at 400,
 * under that cap with margin.
 *
 * Predicate is exactly `expiresAt EXISTS AND expiresAt <= now` — every query
 * below uses `expiresAt <` which structurally cannot match a field-less
 * document (Firestore inequality filters require the field to exist). The
 * per-doc field-less check in reapPaginated() is defense in depth, not the
 * primary guarantee (PLAN-W4 W4-R1).
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const MAX_PAGE_SIZE = 400; // Firestore batch write cap is 500 — stay under it with margin.
export const MAX_PAGES_PER_COLLECTION = 5; // Backlog-drain-time/burst-tolerance sizing — see throughput note above.

export interface ReapResult {
  reaped: number;
  pages: number;
  error?: string;
}

/**
 * Page through a collection-group query (expiresAt < now, plus caller-supplied
 * extra predicate) and apply a per-doc batch mutation, MAX_PAGES_PER_COLLECTION
 * pages at most. Idempotent and safely resumable across runs: each run starts
 * a fresh query from the beginning, so a doc already reaped by a prior run
 * (or a prior page this run) simply never matches again — there is no
 * cross-run cursor state to lose or corrupt.
 */
export async function reapPaginated(
  db: admin.firestore.Firestore,
  collectionGroup: string,
  now: admin.firestore.Timestamp,
  extraWhere: (
    q: admin.firestore.Query<admin.firestore.DocumentData>
  ) => admin.firestore.Query<admin.firestore.DocumentData>,
  applyToBatch: (
    batch: admin.firestore.WriteBatch,
    doc: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>
  ) => void,
  label: string
): Promise<{ reaped: number; pages: number }> {
  let reaped = 0;
  let pages = 0;
  let cursor:
    | admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>
    | undefined;

  while (pages < MAX_PAGES_PER_COLLECTION) {
    let query = extraWhere(
      db.collectionGroup(collectionGroup).where("expiresAt", "<", now)
    )
      .orderBy("expiresAt")
      .limit(MAX_PAGE_SIZE);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    pages++;
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      // W4-R1, defense in depth: the expiresAt<now filter cannot structurally
      // return a field-less doc, but assert it explicitly and skip rather
      // than trust the query alone.
      if (doc.get("expiresAt") == null) {
        functions.logger.warn(
          `[reapExpiredByTTL] ${label}: skipping field-less doc ${doc.ref.path} (should be unreachable via this query)`
        );
        continue;
      }
      applyToBatch(batch, doc);
      batchCount++;
    }
    if (batchCount > 0) {
      await batch.commit();
      reaped += batchCount;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < MAX_PAGE_SIZE) break; // drained — fewer than a full page means no more remain
  }

  return { reaped, pages };
}

export async function reapTasks(
  db: admin.firestore.Firestore,
  now: admin.firestore.Timestamp
): Promise<ReapResult> {
  try {
    // P1 fix: no status filter here. `status != "done"` was correct under
    // the OLD update-based semantics (it stopped re-marking an already-done
    // doc every 15 minutes) but changing update -> delete inverted its
    // meaning to "never delete a completed task" -- exactly backwards, and
    // exactly the dominant steady-state accumulation (every finished task
    // becomes one). The predicate is expiresAt < now, full stop, matching
    // the on-demand reapExpiredTasks.ts tool exactly.
    const { reaped, pages } = await reapPaginated(
      db,
      "tasks",
      now,
      (q) => q,
      (batch, doc) => batch.delete(doc.ref),
      "tasks"
    );
    functions.logger.info(
      `[reapExpiredByTTL] tasks: deleted ${reaped} across ${pages} page(s)`
    );
    return { reaped, pages };
  } catch (error) {
    functions.logger.error("[reapExpiredByTTL] tasks reap failed:", error);
    return { reaped: 0, pages: 0, error: String(error) };
  }
}

export async function reapRelay(
  db: admin.firestore.Firestore,
  now: admin.firestore.Timestamp
): Promise<ReapResult> {
  try {
    const { reaped, pages } = await reapPaginated(
      db,
      "relay",
      now,
      (q) => q.where("status", "==", "pending"),
      (batch, doc) =>
        batch.update(doc.ref, {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
      "relay"
    );
    functions.logger.info(
      `[reapExpiredByTTL] relay: expired ${reaped} across ${pages} page(s)`
    );
    return { reaped, pages };
  } catch (error) {
    functions.logger.error("[reapExpiredByTTL] relay reap failed:", error);
    return { reaped: 0, pages: 0, error: String(error) };
  }
}

export async function reapProposals(
  db: admin.firestore.Firestore,
  now: admin.firestore.Timestamp
): Promise<ReapResult> {
  try {
    const { reaped, pages } = await reapPaginated(
      db,
      "_proposals",
      now,
      (q) => q.where("status", "==", "pending"),
      (batch, doc) => {
        const data = doc.data();
        batch.update(doc.ref, {
          status: "expired",
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          version: (data.version || 1) + 1,
        });
      },
      "_proposals"
    );
    functions.logger.info(
      `[reapExpiredByTTL] _proposals: expired ${reaped} across ${pages} page(s)`
    );
    return { reaped, pages };
  } catch (error) {
    functions.logger.error("[reapExpiredByTTL] _proposals reap failed:", error);
    return { reaped: 0, pages: 0, error: String(error) };
  }
}

export const reapExpiredByTTL = functions
  .runWith({ timeoutSeconds: 300 })
  .pubsub.schedule("every 15 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    functions.logger.info(
      `[reapExpiredByTTL] Reaping expired tasks, relay messages, and proposals (expiresAt < ${now.toDate().toISOString()})`
    );

    // Each reaper isolates its own failure (D3) — run concurrently, none can
    // starve another.
    const [tasks, relay, proposals] = await Promise.all([
      reapTasks(db, now),
      reapRelay(db, now),
      reapProposals(db, now),
    ]);

    const result = { tasks, relay, proposals };
    functions.logger.info("[reapExpiredByTTL] Run complete", result);
    return result;
  });
