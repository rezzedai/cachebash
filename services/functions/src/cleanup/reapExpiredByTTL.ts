/**
 * TTL Reaper — Auto-expire tasks, relay messages, and proposals past their TTL.
 * Runs every 15 minutes.
 *
 * Tasks: DELETE outright once expiresAt <= now (PLAN-W4.2 D2). Previously this
 * only set status=done, so the collection never actually shrank. Paginated
 * within one invocation (PLAN-W4.2 D4): up to TASK_MAX_PAGES pages of
 * TASK_PAGE_SIZE per run, so scheduled throughput can outrun the ~115,000/day
 * creation rate (10 * 400 * 96 runs/day = 384,000/day capacity).
 * Relay: Set status=expired, add expiredAt timestamp (unchanged — a separate
 * cleanup pass owns actual relay message deletion).
 * Proposals: Set status=expired (frees proposer quota, preserves audit trail —
 * unchanged, deliberately never deleted).
 *
 * PLAN-W4.2 D3: the three reapers below run via Promise.allSettled so one's
 * rejection never prevents the other two from completing. A missing/broken
 * index on one must never starve the other two -- that is what
 * happened from 2026-06-09 until this fix: the tasks query's FAILED_PRECONDITION
 * threw before relay or proposals were ever attempted, so all three silently
 * stopped running even though only the tasks index was actually missing.
 *
 * W4-R1 (blocking, carried from PLAN-W4): never delete/reap a doc lacking
 * expiresAt, and never key off `ttl` -- ttl:0 is the never-expires sentinel;
 * reading it as a deadline would delete exactly the set it protects. The
 * queries below filter on expiresAt only; the field-less guard inside the
 * task loop is belt-and-suspenders.
 *
 * Collection group queries for scalability.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

// 400 (not Firestore's 500 write cap) leaves headroom for the field-less guard
// to skip a few docs without needing a second commit for the same page.
const TASK_PAGE_SIZE = 400;
// 10 pages * 400 = 4,000 deletes/run * 96 runs/day (every 15 min) = 384,000/day
// capacity -- beats the ~115,000/day creation rate with >3x margin (PLAN-W4.2 D4).
const TASK_MAX_PAGES = 10;

async function reapExpiredTasksTTL(
  db: admin.firestore.Firestore,
  now: admin.firestore.Timestamp
): Promise<number> {
  let deleted = 0;
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;

  for (let page = 0; page < TASK_MAX_PAGES; page++) {
    // No explicit orderBy: Firestore's implicit order for this filter shape
    // (expiresAt ASC, status ASC, __name__ ASC) is exactly the composite index
    // PLAN-W4.2 D1 creates, and startAfter(DocumentSnapshot) rides that order
    // without needing to restate it.
    let q = db
      .collectionGroup("tasks")
      .where("expiresAt", "<", now)
      .where("status", "!=", "done")
      .limit(TASK_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      // W4-R1: never delete a doc lacking expiresAt (the query already
      // excludes these; asserted explicitly anyway per PLAN-W4.2 constraints).
      if (data.expiresAt === undefined) continue;
      batch.delete(doc.ref);
      batchCount++;
    }
    if (batchCount > 0) {
      await batch.commit();
      deleted += batchCount;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < TASK_PAGE_SIZE) break; // this run's candidates are exhausted
  }

  return deleted;
}

async function reapExpiredRelay(db: admin.firestore.Firestore, now: admin.firestore.Timestamp): Promise<number> {
  const expiredRelay = await db
    .collectionGroup("relay")
    .where("expiresAt", "<", now)
    .where("status", "==", "pending")
    .limit(500)
    .get();

  if (expiredRelay.empty) return 0;

  const batch = db.batch();
  for (const doc of expiredRelay.docs) {
    batch.update(doc.ref, {
      status: "expired",
      expiredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return expiredRelay.size;
}

async function reapExpiredProposals(db: admin.firestore.Firestore, now: admin.firestore.Timestamp): Promise<number> {
  // Path: tenants/{userId}/gsp_proposals/{proposalId}
  const expiredProposals = await db
    .collectionGroup("_proposals")
    .where("expiresAt", "<", now)
    .where("status", "==", "pending")
    .limit(500)
    .get();

  if (expiredProposals.empty) return 0;

  const batch = db.batch();
  for (const doc of expiredProposals.docs) {
    const data = doc.data();
    batch.update(doc.ref, {
      status: "expired",
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: (data.version || 1) + 1,
    });
  }
  await batch.commit();
  return expiredProposals.size;
}

export const reapExpiredByTTL = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    functions.logger.info(
      `[reapExpiredByTTL v2] Reaping expired tasks (delete), relay messages, and proposals (expiresAt < ${now.toDate().toISOString()})`
    );

    // PLAN-W4.2 D3: independent try/catch per reaper -- one's failure (e.g. a
    // missing index) must not prevent the other two from running.
    const results = await Promise.allSettled([
      reapExpiredTasksTTL(db, now),
      reapExpiredRelay(db, now),
      reapExpiredProposals(db, now),
    ]);

    const [tasksResult, relayResult, proposalsResult] = results;
    const tasksReaped = tasksResult.status === "fulfilled" ? tasksResult.value : 0;
    const relayReaped = relayResult.status === "fulfilled" ? relayResult.value : 0;
    const proposalsReaped = proposalsResult.status === "fulfilled" ? proposalsResult.value : 0;

    if (tasksResult.status === "rejected") {
      functions.logger.error("[reapExpiredByTTL v2] tasks reap failed:", tasksResult.reason);
    }
    if (relayResult.status === "rejected") {
      functions.logger.error("[reapExpiredByTTL v2] relay reap failed:", relayResult.reason);
    }
    if (proposalsResult.status === "rejected") {
      functions.logger.error("[reapExpiredByTTL v2] proposals reap failed:", proposalsResult.reason);
    }

    functions.logger.info(
      `[reapExpiredByTTL v2] Deleted ${tasksReaped} task(s), expired ${relayReaped} relay message(s), and ${proposalsReaped} proposal(s)`
    );

    return { tasksReaped, relayReaped, proposalsReaped };
  });
