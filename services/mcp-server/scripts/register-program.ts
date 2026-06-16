/**
 * Register (or upsert) one or more programs in the Firestore program registry.
 *
 * Why a script and not programs_update_program via MCP: the MCP tool ONLY
 * updates an existing program doc — it returns "Program not found" for a new
 * programId, and there is deliberately NO MCP create path (program creation is
 * a DB-layer bootstrap, same design stance as key minting in
 * mint-command-center-key.ts). So the first registration of a new identity —
 * e.g. a VECTOR sub-instance like vector_systems_research / vector_cerebro that
 * already has a minted key + live session but no registry entry — must be
 * written at the Firestore layer by a principal with datastore write.
 *
 * Without a registry entry, dispatch target-validation rejects the program as
 * an "unknown target", so every dispatch (and every scheduled cron targeting
 * it) fails. This script closes that gap and is the reusable replacement for
 * the hard-coded register-core-programs.ts.
 *
 * Run with write-capable creds + the prod project:
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx \
 *     services/mcp-server/scripts/register-program.ts '<json>'
 *
 * <json> is a single program object or an array of them:
 *   { "programId": "...", "displayName": "...", "role": "...",
 *     "groups": ["..."], "tags": ["..."], "color": "#RRGGBB" }
 * Only programId is required; the rest default sensibly.
 *
 * Idempotent: existing docs are metadata-merged (createdAt/createdBy preserved);
 * new docs are created with createdAt + createdBy (defaults to "vector").
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

interface ProgramEntry {
  programId: string;
  displayName?: string;
  role?: string;
  groups?: string[];
  tags?: string[];
  color?: string;
  createdBy?: string;
}

function parseInput(): ProgramEntry[] {
  const raw = process.argv[2];
  if (!raw) {
    console.error(
      "ERROR: pass a program JSON object or array as argv[2].\n" +
        "Example: register-program.ts '{\"programId\":\"vector_cerebro\",\"role\":\"orchestrator\"}'",
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: argv[2] is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  for (const p of list) {
    if (!p || typeof (p as ProgramEntry).programId !== "string") {
      console.error("ERROR: every entry must have a string programId");
      process.exit(1);
    }
    // F1: guard against path-injection via '/' — Firestore doc path would redirect to unintended nested path
    if (!/^[a-z0-9_-]{1,64}$/.test((p as ProgramEntry).programId)) {
      console.error(`ERROR: programId "${(p as ProgramEntry).programId}" must match ^[a-z0-9_-]{1,64}$`);
      process.exit(1);
    }
  }
  return list as ProgramEntry[];
}

async function registerPrograms() {
  const entries = parseInput();

  // Resolve tenant userId from any existing key (single-tenant assumption),
  // matching register-core-programs.ts.
  const keySnap = await db.collection("keyIndex").limit(1).get();
  if (keySnap.empty) {
    console.error("ERROR: No keys in keyIndex — cannot resolve userId");
    process.exit(1);
  }
  const userId = keySnap.docs[0].data().userId;
  console.log(`Tenant userId: ${userId}`);
  console.log(`Registering ${entries.length} program(s)...\n`);

  let created = 0;
  let updated = 0;

  for (const prog of entries) {
    const ref = db.doc(`tenants/${userId}/programs/${prog.programId}`);
    const existing = await ref.get();

    const doc: Record<string, unknown> = {
      programId: prog.programId,
      displayName: prog.displayName ?? prog.programId,
      role: prog.role ?? "orchestrator",
      groups: prog.groups ?? [],
      tags: prog.tags ?? [],
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: prog.createdBy ?? "vector",
    };
    if (prog.color) doc.color = prog.color;

    if (existing.exists) {
      await ref.update(doc);
      console.log(`  UPDATED: ${prog.programId} (${doc.displayName}) — ${doc.role}`);
      updated++;
    } else {
      await ref.set({
        ...doc,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: prog.createdBy ?? "vector",
      });
      console.log(`  CREATED: ${prog.programId} (${doc.displayName}) — ${doc.role}`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Total: ${entries.length}`);

  // Verify the just-written entries are readable.
  console.log("\n--- Verification ---");
  const ids = new Set(entries.map((e) => e.programId));
  const snapshot = await db
    .collection(`tenants/${userId}/programs`)
    .where("active", "==", true)
    .get();
  for (const d of snapshot.docs) {
    if (ids.has(d.id)) {
      const data = d.data();
      console.log(
        `  ${d.id}: role=${data.role}, groups=${JSON.stringify(data.groups)}, tags=${JSON.stringify(data.tags)}`,
      );
    }
  }
}

registerPrograms().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
