/**
 * seed-all-tenants.ts — one-shot pre-deploy seed of WS-3 ceilings for EVERY
 * active tenant org, so the fail-closed breaker does not deny the fleet the
 * moment enforcement deploys. Owner ADC required (write).
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx services/mcp-server/scripts/seed-all-tenants.ts
 *
 * Idempotent (merge). Never sets paused (kill switch is a separate action).
 * Go-live posture: generous ceilings — per-key catches a single runaway,
 * org caps a multi-program storm; tighten after observing real volume via
 * the breaker's signal alerts. Any active org NOT in OVERRIDES gets
 * DEFAULT_CEILINGS.
 */
import * as admin from "firebase-admin";
import { DEFAULT_CEILINGS } from "../src/middleware/circuitBreaker.js";

// Per-tenant overrides keyed by Firestore userId (auth.userId at runtime).
const OVERRIDES: Record<string, { perKeyLimit: number; orgLimit: number; windowMs: number }> = {
  // Main Grid fleet — 29 programs share this org; each program is its own key.
  "7viFKVtl5lgzguhFoZlnYYrqeDG2": { perKeyLimit: 100, orgLimit: 1500, windowMs: 60_000 },
  // Dispatcher — single key, high task-mutation volume (claim/complete/create/retry).
  "T0NWeYZIfcY7cvLK4BrOEIzaUHJ2": { perKeyLimit: 120, orgLimit: 300, windowMs: 60_000 },
};

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  // Ground-truth the active orgs from keyIndex (do not hardcode the list).
  const keys = await db.collection("keyIndex").get();
  const orgs = new Set<string>();
  for (const doc of keys.docs) {
    const d = doc.data();
    if (d.active === true && d.userId) orgs.add(d.userId);
  }

  console.error(`\nSeeding ceilings for ${orgs.size} active orgs...\n`);
  for (const org of orgs) {
    const cfg = OVERRIDES[org] ?? {
      perKeyLimit: DEFAULT_CEILINGS.perKeyLimit,
      orgLimit: DEFAULT_CEILINGS.orgLimit,
      windowMs: DEFAULT_CEILINGS.windowMs,
    };
    const ref = db.doc(`tenants/${org}/_meta/ceilings`);
    // merge:true — never clobber a paused flag or other future fields.
    await ref.set({ ...cfg, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const after = (await ref.get()).data()!;
    const tag = OVERRIDES[org] ? "OVERRIDE" : "default ";
    console.error(`  ${org}  [${tag}] perKey=${after.perKeyLimit} org=${after.orgLimit} win=${after.windowMs} paused=${after.paused === true}`);
  }
  console.error("\ndone");
}

main().catch((e) => { console.error(e); process.exit(1); });
