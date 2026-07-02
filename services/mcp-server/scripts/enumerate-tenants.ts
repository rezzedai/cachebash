/**
 * enumerate-tenants.ts — list distinct active-key tenant orgs + whether each
 * already has a WS-3 ceilings doc. Owner ADC required (read-only is fine).
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx services/mcp-server/scripts/enumerate-tenants.ts
 */
import * as admin from "firebase-admin";

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const keys = await db.collection("keyIndex").get();
  const orgs = new Map<string, { active: number; programs: Set<string> }>();
  for (const doc of keys.docs) {
    const d = doc.data();
    if (d.active !== true) continue;
    const org = d.userId;
    if (!org) continue;
    const e = orgs.get(org) || { active: 0, programs: new Set<string>() };
    e.active += 1;
    if (d.programId) e.programs.add(d.programId);
    orgs.set(org, e);
  }

  console.error(`\nDistinct active-key tenant orgs: ${orgs.size}\n`);
  for (const [org, e] of orgs) {
    const snap = await db.doc(`tenants/${org}/_meta/ceilings`).get();
    const c = snap.exists ? snap.data()! : null;
    const ceil = c ? `perKey=${c.perKeyLimit} org=${c.orgLimit} win=${c.windowMs} paused=${c.paused === true}` : "MISSING";
    console.error(`${org}  keys=${e.active}  programs=[${[...e.programs].join(",")}]`);
    console.error(`    ceilings: ${snap.exists ? "EXISTS" : "MISSING"}  ${ceil}`);
  }
  console.error("\ndone");
}

main().catch((e) => { console.error(e); process.exit(1); });
