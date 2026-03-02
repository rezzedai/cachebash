/**
 * One-time migration: Patch keys with empty capabilities.
 *
 * Targets:
 *   - 08ca989d952feee2dea6ee4b20ea6e457748a55b6ed91ab72f7c0f38c0f71eb5 (intel-ingest)
 *   - 34a64f646a35d1126762839f0d668e3542c360d1a24f3f20222cad23fa58c452 (test key)
 *
 * Usage: npx tsx services/mcp-server/scripts/patch-empty-capabilities.ts
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const BROKEN_HASHES = [
  "08ca989d952feee2dea6ee4b20ea6e457748a55b6ed91ab72f7c0f38c0f71eb5",
  "34a64f646a35d1126762839f0d668e3542c360d1a24f3f20222cad23fa58c452",
];

async function patchEmptyCapabilities() {
  console.log("Patching keys with empty capabilities...\n");

  for (const hash of BROKEN_HASHES) {
    const ref = db.doc(`keyIndex/${hash}`);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`  SKIP: ${hash.slice(0, 12)}... — not found`);
      continue;
    }

    const data = doc.data()!;
    const caps = data.capabilities;

    if (Array.isArray(caps) && caps.length === 0) {
      await ref.update({ capabilities: ["*"] });
      console.log(`  FIXED: ${hash.slice(0, 12)}... (${data.label || data.programId}) — set capabilities: ["*"]`);
    } else {
      console.log(`  OK: ${hash.slice(0, 12)}... — capabilities already set: ${JSON.stringify(caps)}`);
    }
  }

  console.log("\nDone.");
}

patchEmptyCapabilities().catch(console.error);
