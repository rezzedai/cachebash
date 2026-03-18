/**
 * Register all core Grid programs in Firestore.
 *
 * Upserts 10 program documents in the programs collection with
 * role, groups, and tags metadata for the Grid's program registry.
 *
 * Usage: npx tsx services/mcp-server/scripts/register-core-programs.ts
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

interface ProgramEntry {
  programId: string;
  displayName: string;
  role: string;
  groups: string[];
  tags: string[];
}

const CORE_PROGRAMS: ProgramEntry[] = [
  { programId: "vector", displayName: "VECTOR", role: "orchestrator", groups: ["council"], tags: ["opus", "strategic-counsel"] },
  { programId: "iso", displayName: "ISO", role: "orchestrator", groups: ["builders"], tags: ["opus", "sprint-manager"] },
  { programId: "basher", displayName: "BASHER", role: "builder", groups: ["builders"], tags: ["opus-sonnet", "builder-deployer"] },
  { programId: "sark", displayName: "SARK", role: "specialist", groups: ["intelligence"], tags: ["sonnet", "qa-security"] },
  { programId: "alan", displayName: "ALAN", role: "architect", groups: ["council"], tags: ["opus", "chief-architect"] },
  { programId: "castor", displayName: "CASTOR", role: "specialist", groups: [], tags: ["sonnet-opus", "content-strategist"] },
  { programId: "beck", displayName: "BECK", role: "builder", groups: ["builders"], tags: ["sonnet", "enrichment"] },
  { programId: "quorra", displayName: "QUORRA", role: "specialist", groups: [], tags: ["sonnet-opus", "product-designer"] },
  { programId: "radia", displayName: "RADIA", role: "architect", groups: ["council"], tags: ["opus", "visionary"] },
  { programId: "ram", displayName: "RAM", role: "specialist", groups: [], tags: ["sonnet", "knowledge-manager"] },
];

async function registerCorePrograms() {
  console.log("Resolving tenant userId from keyIndex...\n");

  // Get userId from any existing key (single-tenant assumption)
  const keySnap = await db.collection("keyIndex").limit(1).get();
  if (keySnap.empty) {
    console.error("ERROR: No keys in keyIndex — cannot resolve userId");
    process.exit(1);
  }
  const userId = keySnap.docs[0].data().userId;
  console.log(`Tenant userId: ${userId}\n`);

  console.log(`Registering ${CORE_PROGRAMS.length} core programs...\n`);

  let created = 0;
  let updated = 0;

  for (const prog of CORE_PROGRAMS) {
    const ref = db.doc(`tenants/${userId}/programs/${prog.programId}`);
    const existing = await ref.get();

    const doc = {
      programId: prog.programId,
      displayName: prog.displayName,
      role: prog.role,
      groups: prog.groups,
      tags: prog.tags,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: "iso",
    };

    if (existing.exists) {
      // Merge: update metadata fields but preserve createdAt/createdBy
      await ref.update(doc);
      console.log(`  UPDATED: ${prog.programId} (${prog.displayName}) — ${prog.role}`);
      updated++;
    } else {
      // Create with createdAt
      await ref.set({
        ...doc,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: "iso",
      });
      console.log(`  CREATED: ${prog.programId} (${prog.displayName}) — ${prog.role}`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Total: ${CORE_PROGRAMS.length}`);

  // Verify by listing all programs
  console.log("\n--- Verification ---");
  const snapshot = await db.collection(`tenants/${userId}/programs`)
    .where("active", "==", true)
    .get();

  console.log(`Total active programs in Firestore: ${snapshot.size}\n`);

  const coreIds = new Set(CORE_PROGRAMS.map(p => p.programId));
  for (const doc of snapshot.docs) {
    if (coreIds.has(doc.id)) {
      const data = doc.data();
      console.log(`  ${doc.id}: role=${data.role}, groups=${JSON.stringify(data.groups)}, tags=${JSON.stringify(data.tags)}`);
    }
  }
}

registerCorePrograms().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
