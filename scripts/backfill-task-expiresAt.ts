#!/usr/bin/env tsx
/**
 * PLAN-W1 — DRY-RUN read-only reporting harness for the field-less-task backfill.
 *
 * Every document in tenants/{tenant}/tasks that has NO `expiresAt` field predates
 * the dispatch()/create_task ttl fixes (PLAN-W2/W2b) and is invisible to any
 * expiresAt-based reasoning — including PLAN-W4's planned reaper, which must never
 * treat "field absent" as "already expired". This script finds every such document
 * and reports what its expiresAt SHOULD be, using the shared classification logic
 * in src/modules/dispatch/expiresAtBackfillClassifier.ts.
 *
 * THIS SCRIPT NEVER WRITES. There is no --execute flag. Per ISO/VECTOR's ruling:
 * grid-deployer's write-capable IAM binding will NOT be restored (it was a
 * Developer Connect setup grant that expired 216 days ago; expanding a deploy
 * identity's blast radius on production Firestore for an ops script is not the
 * right shape). The actual backfill write — and PLAN-W4's recurring reap — belong
 * INSIDE cachebash-mcp, executed by the service under its own runtime service
 * account (922749444863-compute@developer.gserviceaccount.com, roles/editor,
 * unconditioned — the identity every create_task/dispatch write already uses),
 * as a scheduled/gated path in the service, not a local script run by hand. That
 * execution path is a separate, future, explicitly-authorized dispatch. This
 * script's only job is to produce the numbers ISO needs to evaluate the split
 * before a byte is written anywhere.
 *
 * Reads only. Uses this repo's existing read access (roles/viewer is unconditioned
 * and unaffected by the expired datastore.owner write grant).
 *
 * Firestore cannot query "field does not exist" directly (an inequality filter on
 * expiresAt only ever matches documents that HAVE the field — the complement of
 * what we want), so this pages the entire collection by document id and filters
 * client-side, exactly like the PLAN-W3 export did.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { classifyForBackfill, type BackfillClassification } from "../services/mcp-server/src/modules/dispatch/expiresAtBackfillClassifier.js";

const TENANT = "7viFKVtl5lgzguhFoZlnYYrqeDG2";
const PAGE_SIZE = 1000;

initializeApp({ credential: applicationDefault(), projectId: "cachebash-app" });
const db = getFirestore();

interface Row {
  id: string;
  source: string;
  type: string;
  status: string;
  createdAtMs: number | null;
  classification: BackfillClassification;
}

async function main() {
  const col = db.collection(`tenants/${TENANT}/tasks`);
  const rows: Row[] = [];
  let scanned = 0;
  let lastDoc: QueryDocumentSnapshot | null = null;

  console.log(`[w1] DRY-RUN (read-only; this script has no write path)`);
  console.log(`[w1] scanning full collection tenants/${TENANT}/tasks, paged by document id, filtering client-side for missing expiresAt...`);

  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      if (data.expiresAt !== undefined) continue; // has the field -- not our population

      const classification = classifyForBackfill(data);
      rows.push({
        id: doc.id,
        source: (data.source as string) ?? "(none)",
        type: (data.type as string) ?? "(none)",
        status: (data.status as string) ?? "(none)",
        createdAtMs: data.createdAt?.toDate ? data.createdAt.toDate().getTime() : null,
        classification,
      });
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (scanned % 20000 < PAGE_SIZE) console.log(`[w1] ...scanned ${scanned} docs so far, ${rows.length} field-less`);
    if (snap.size < PAGE_SIZE) break;
  }

  console.log(`[w1] scan complete: ${scanned} total docs scanned, ${rows.length} field-less`);

  // ── Report ──
  const reapable = rows.filter((r) => r.classification.branch === "reapable");
  const sentinel = rows.filter((r) => r.classification.branch === "sentinel");
  const ambiguous = rows.filter((r) => r.classification.ambiguous);

  function breakdown(key: "source" | "type") {
    const out: Record<string, { reapable: number; sentinel: number }> = {};
    for (const r of rows) {
      const k = r[key];
      out[k] ??= { reapable: 0, sentinel: 0 };
      out[k][r.classification.branch]++;
    }
    return out;
  }

  const byCreatedAt = rows.filter((r) => r.createdAtMs !== null).sort((a, b) => a.createdAtMs! - b.createdAtMs!);
  const oldest10 = byCreatedAt.slice(0, 10);
  const newest10 = byCreatedAt.slice(-10).reverse();

  const report = {
    mode: "DRY-RUN",
    totalDocsScanned: scanned,
    totalFieldLess: rows.length,
    expectedFieldLess: 5493,
    matchesExpected: rows.length === 5493,
    split: { reapable: reapable.length, sentinel: sentinel.length },
    ambiguousCount: ambiguous.length,
    bySource: breakdown("source"),
    byType: breakdown("type"),
    oldest10: oldest10.map((r) => ({ id: r.id, source: r.source, type: r.type, status: r.status, createdAt: r.createdAtMs ? new Date(r.createdAtMs).toISOString() : null, branch: r.classification.branch })),
    newest10: newest10.map((r) => ({ id: r.id, source: r.source, type: r.type, status: r.status, createdAt: r.createdAtMs ? new Date(r.createdAtMs).toISOString() : null, branch: r.classification.branch })),
    ambiguous: ambiguous.map((r) => ({ id: r.id, source: r.source, type: r.type, status: r.status, reason: r.classification.reason })),
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("[w1] DRY-RUN complete. No writes performed. No write path exists in this script.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[w1] FATAL:", err);
    process.exit(1);
  });
