/**
 * Add programs.write capability to VECTOR's API keys.
 *
 * VECTOR's 6 keys in keyIndex are missing programs.write, which blocks
 * program registration. This script finds all VECTOR keys and adds
 * "programs.write" to their capabilities array.
 *
 * Usage: npx tsx services/mcp-server/scripts/add-programs-write-to-vector.ts
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

async function addProgramsWriteToVector() {
  console.log("Finding VECTOR's API keys...\n");

  const keysSnapshot = await db
    .collection("keyIndex")
    .where("programId", "==", "vector")
    .get();

  if (keysSnapshot.empty) {
    console.log("ERROR: No keys found for programId=vector");
    process.exit(1);
  }

  console.log(`Found ${keysSnapshot.size} key(s) for VECTOR:\n`);

  let updated = 0;
  let skipped = 0;

  for (const doc of keysSnapshot.docs) {
    const data = doc.data();
    const keyHash = doc.id;
    const currentCaps = data.capabilities || [];

    console.log(`Key: ${keyHash.slice(0, 12)}...`);
    console.log(`  Label: ${data.label || "(none)"}`);
    console.log(`  UserId: ${data.userId}`);
    console.log(`  Current capabilities: ${JSON.stringify(currentCaps)}`);

    if (currentCaps.includes("programs.write")) {
      console.log("  -> programs.write already present — skipping\n");
      skipped++;
      continue;
    }

    if (currentCaps.includes("*")) {
      console.log("  -> Wildcard (*) present — programs.write implied, skipping\n");
      skipped++;
      continue;
    }

    const updatedCaps = [...currentCaps, "programs.write"];
    console.log(`  Updating to: ${JSON.stringify(updatedCaps)}`);

    await db.doc(`keyIndex/${keyHash}`).update({
      capabilities: updatedCaps,
    });

    console.log("  -> Updated successfully\n");
    updated++;
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}, Total: ${keysSnapshot.size}`);
}

addProgramsWriteToVector().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
