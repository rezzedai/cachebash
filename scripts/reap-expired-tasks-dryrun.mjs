// PLAN-W4 stage-1 DRY-RUN. Read-only (grid-deployer's unconditioned roles/viewer).
// Deletion predicate under test: expiresAt EXISTS AND expiresAt <= now.
// Never touches a field-less doc -- excluded structurally (data.expiresAt === undefined
// -> counted separately, never classified as a delete candidate).
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";

const TENANT = "7viFKVtl5lgzguhFoZlnYYrqeDG2";
const PAGE_SIZE = 1000;
const nowMs = Date.now();

initializeApp({ credential: applicationDefault(), projectId: "cachebash-app" });
const db = getFirestore();

const RESCUED_IDS = [
  "rwM8j9SCL5NsVF3hy2Uz", "qTgDezWsmx7qJMKrpECD", "XJzi3AD7IXIDW6uKL749",
  "BNr2F6LRe8fYH7ovCfAK", "lVqcfEmgHeMkT8lOHId7", "1S1w8dqDnsJ4Gmg9aNyc",
];

async function main() {
  const col = db.collection(`tenants/${TENANT}/tasks`);
  let scanned = 0, fieldLess = 0, live = 0, expired = 0;
  const bySource = {};
  const rescuedSeen = {};
  let lastDoc = null;

  console.log("[w4-dryrun] scanning full collection, paged by document id, read-only...");
  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();

      if (RESCUED_IDS.includes(doc.id)) {
        rescuedSeen[doc.id] = {
          expiresAt: data.expiresAt ? data.expiresAt.toDate().toISOString() : null,
          status: data.status ?? null,
        };
      }

      if (data.expiresAt === undefined) { fieldLess++; continue; }
      const expiresAtMs = data.expiresAt.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
      if (expiresAtMs > nowMs) { live++; continue; }

      expired++;
      const src = data.source ?? "(none)";
      bySource[src] = (bySource[src] || 0) + 1;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (scanned % 20000 < PAGE_SIZE) console.log(`[w4-dryrun] ...scanned ${scanned}`);
    if (snap.size < PAGE_SIZE) break;
  }

  const report = {
    mode: "DRY-RUN",
    scanned,
    fieldLess,
    expectedFieldLess: 5495,
    fieldLessMatchesExpected: fieldLess === 5495,
    live,
    expiredCandidates: expired,
    bySourceTop: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    enrichmentWorkerCohort: bySource["enrichment-worker"] ?? 0,
    rescuedCarryForwards: rescuedSeen,
    rescuedCount: Object.keys(rescuedSeen).length,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error("[w4-dryrun] FATAL:", err); process.exit(1); });
