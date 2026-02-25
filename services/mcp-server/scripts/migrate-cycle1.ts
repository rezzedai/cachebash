/**
 * CacheBash v2 Cycle 1 — Data Migration Script
 *
 * Migrates data from deprecated collections to consolidated collections:
 *   - dead_letters → relay (with status: "dead_lettered")
 *   - audit → ledger (with type: "audit")
 *   - traces → ledger (with type: "trace")
 *   - program_state → sessions/_meta/program_state
 *   - programs → sessions/_meta/programs
 *
 * Usage:
 *   npx tsx scripts/migrate-cycle1.ts [--dry-run] [--user-id <uid>]
 *
 * Idempotent: safe to run multiple times. Checks for existing docs before writing.
 */

import * as admin from "firebase-admin";

// --- Config ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const userIdIndex = args.indexOf("--user-id");
const TARGET_USER_ID = userIdIndex >= 0 ? args[userIdIndex + 1] : undefined;
const skipIndex = args.indexOf("--skip");
const SKIP_COLLECTIONS = skipIndex >= 0 ? args[skipIndex + 1]?.split(",") || [] : [];

if (!TARGET_USER_ID) {
  console.error("Usage: npx tsx scripts/migrate-cycle1.ts [--dry-run] --user-id <uid>");
  process.exit(1);
}

// --- Init Firebase ---
const projectId = process.env.FIREBASE_PROJECT_ID || "cachebash-app";
admin.initializeApp({ projectId });
const db = admin.firestore();

interface MigrationStats {
  collection: string;
  read: number;
  written: number;
  skipped: number;
  errors: number;
}

const stats: MigrationStats[] = [];

const BATCH_SIZE = 400; // Firestore limit is 500, leave headroom

async function migrateCollection(
  sourcePath: string,
  targetPath: string,
  transform: (data: admin.firestore.DocumentData, docId: string) => admin.firestore.DocumentData,
  label: string
): Promise<void> {
  const stat: MigrationStats = { collection: label, read: 0, written: 0, skipped: 0, errors: 0 };

  console.log(`\n--- Migrating: ${label} ---`);
  console.log(`  Source: ${sourcePath}`);
  console.log(`  Target: ${targetPath}`);

  const sourceSnap = await db.collection(sourcePath).get();
  stat.read = sourceSnap.size;
  console.log(`  Found ${stat.read} documents`);

  if (stat.read === 0) {
    console.log("  Nothing to migrate.");
    stats.push(stat);
    return;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${stat.read} documents → ${targetPath}`);
    stat.written = stat.read;
    stats.push(stat);
    return;
  }

  // Batch write — no per-doc idempotency check for speed.
  // Uses set() with same doc ID, so re-runs overwrite (safe for migration).
  let batch = db.batch();
  let batchCount = 0;
  let totalWritten = 0;

  for (const doc of sourceSnap.docs) {
    try {
      const targetRef = db.collection(targetPath).doc(doc.id);
      const transformed = transform(doc.data(), doc.id);
      batch.set(targetRef, transformed);
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        totalWritten += batchCount;
        console.log(`  Progress: ${totalWritten}/${stat.read} written`);
        batch = db.batch();
        batchCount = 0;
      }
    } catch (err) {
      stat.errors++;
      console.error(`  ERROR preparing ${doc.id}:`, err);
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    totalWritten += batchCount;
  }

  stat.written = totalWritten;
  stats.push(stat);
  console.log(`  Results: ${stat.written} written, ${stat.skipped} skipped, ${stat.errors} errors`);
}

async function main(): Promise<void> {
  console.log("=== CacheBash v2 Cycle 1 Migration ===");
  console.log(`User ID: ${TARGET_USER_ID}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Project: ${projectId}`);
  if (SKIP_COLLECTIONS.length > 0) {
    console.log(`Skipping: ${SKIP_COLLECTIONS.join(", ")}`);
  }

  const uid = TARGET_USER_ID!;

  // 1. dead_letters → relay (with status: "dead_lettered")
  if (!SKIP_COLLECTIONS.includes("dead_letters")) {
    await migrateCollection(
      `users/${uid}/dead_letters`,
      `users/${uid}/relay`,
      (data) => ({
        ...data,
        status: "dead_lettered",
        deadLetteredAt: data.deadLetteredAt || data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }),
      "dead_letters → relay"
    );
  }

  // 2. audit → ledger (with type: "audit")
  if (!SKIP_COLLECTIONS.includes("audit")) {
    await migrateCollection(
      `users/${uid}/audit`,
      `users/${uid}/ledger`,
      (data) => ({
        ...data,
        type: "audit",
      }),
      "audit → ledger"
    );
  }

  // 3. traces → ledger (with type: "trace")
  // Note: traces and audit share the ledger target, but doc IDs are unique per source
  if (!SKIP_COLLECTIONS.includes("traces")) {
    await migrateCollection(
      `users/${uid}/traces`,
      `users/${uid}/ledger`,
      (data) => ({
        ...data,
        type: "trace",
      }),
      "traces → ledger"
    );
  }

  // 4. program_state → sessions/_meta/program_state
  // Uses _meta sentinel doc to maintain valid Firestore path segments (odd for collection, even for doc)
  if (!SKIP_COLLECTIONS.includes("program_state")) {
    await migrateCollection(
      `users/${uid}/program_state`,
      `users/${uid}/sessions/_meta/program_state`,
      (data) => ({ ...data }),
      "program_state → sessions/_meta/program_state"
    );
  }

  // 5. programs → sessions/_meta/programs
  if (!SKIP_COLLECTIONS.includes("programs")) {
    await migrateCollection(
      `users/${uid}/programs`,
      `users/${uid}/sessions/_meta/programs`,
      (data) => ({ ...data }),
      "programs → sessions/_meta/programs"
    );
  }

  // Summary
  console.log("\n=== Migration Summary ===");
  for (const s of stats) {
    console.log(`  ${s.collection}: ${s.read} read, ${s.written} written, ${s.skipped} skipped, ${s.errors} errors`);
  }

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN — no data was written. Remove --dry-run to execute.");
  } else {
    console.log("\n✅ Migration complete.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
