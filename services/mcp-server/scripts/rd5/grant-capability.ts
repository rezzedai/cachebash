/**
 * RD-5 grant-capability. Dry-run by default; --apply does one arrayUnion on
 * `capabilities` and touches no other field. No remove, rotate or revoke mode.
 * Usage: npx tsx services/mcp-server/scripts/rd5/grant-capability.ts --key-hash <64-hex> --add <capability> [--apply]
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { runGrant } from "../../src/auth/rd5/grantCapability.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const keyHash = arg("--key-hash");
  const add = arg("--add");
  if (!keyHash || !add) {
    console.error("usage: grant-capability.ts --key-hash <64-hex> --add <capability> [--apply]");
    process.exit(2);
  }
  initializeApp();
  const result = await runGrant(getFirestore() as never, {
    keyHash,
    add,
    apply: process.argv.includes("--apply"),
    arrayUnion: (...v: string[]) => FieldValue.arrayUnion(...v),
  });
  for (const l of result.lines) console.log(l);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
