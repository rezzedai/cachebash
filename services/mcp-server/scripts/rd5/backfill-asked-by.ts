/**
 * RD-5 PR-L backfill of `askedBy` on question tasks. Dry-run by default; --apply writes `askedBy` only.
 * Usage: npx tsx services/mcp-server/scripts/rd5/backfill-asked-by.ts --tenant <uid> [--apply]
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runAskedByBackfill } from "../../src/auth/rd5/askedByBackfill.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tenantUid = arg("--tenant");
  if (!tenantUid) {
    console.error("usage: backfill-asked-by.ts --tenant <uid> [--apply]");
    process.exit(2);
  }
  initializeApp();
  const result = await runAskedByBackfill(getFirestore() as never, { tenantUid, apply: process.argv.includes("--apply") });
  for (const l of result.lines) console.log(l);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
