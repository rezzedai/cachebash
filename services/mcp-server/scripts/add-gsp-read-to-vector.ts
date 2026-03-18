/**
 * Story 3: Add gsp.read capability to VECTOR's API key
 *
 * VECTOR has gsp.write but is missing gsp.read — this was an oversight during key creation.
 * This script finds VECTOR's key and adds gsp.read to its capabilities array.
 *
 * Usage: npx tsx services/mcp-server/scripts/add-gsp-read-to-vector.ts
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

async function addGspReadToVector() {
  console.log("Finding VECTOR's API key...\n");

  // Query keyIndex for programId=vector
  const keysSnapshot = await db
    .collection("keyIndex")
    .where("programId", "==", "vector")
    .get();

  if (keysSnapshot.empty) {
    console.log("ERROR: No keys found for programId=vector");
    return;
  }

  console.log(`Found ${keysSnapshot.size} key(s) for VECTOR:\n`);

  for (const doc of keysSnapshot.docs) {
    const data = doc.data();
    const keyHash = doc.id;
    const currentCaps = data.capabilities || [];

    console.log(`Key: ${keyHash.slice(0, 12)}...`);
    console.log(`Label: ${data.label || "(none)"}`);
    console.log(`UserId: ${data.userId}`);
    console.log(`Current capabilities: ${JSON.stringify(currentCaps)}`);

    // Check if gsp.read is already present
    if (currentCaps.includes("gsp.read")) {
      console.log("✅ gsp.read already present — no update needed\n");
      continue;
    }

    // Add gsp.read to capabilities
    const updatedCaps = [...currentCaps, "gsp.read"];

    console.log(`Updating to: ${JSON.stringify(updatedCaps)}`);

    await db.doc(`keyIndex/${keyHash}`).update({
      capabilities: updatedCaps,
    });

    console.log("✅ Updated successfully\n");
  }

  console.log("Done.");
}

addGspReadToVector().catch(console.error);
