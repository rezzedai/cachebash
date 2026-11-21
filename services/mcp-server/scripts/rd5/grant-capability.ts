/**
 * RD-5 grant-capability. Dry-run by default; --apply does one arrayUnion on
 * `capabilities` and touches no other field. The one removal mode is --remove-wildcard (RD-5 PR-N N-D9): it removes
 * exactly the wildcard, and refuses an empty result or a list lacking any --expect capability.
 * Usage: npx tsx services/mcp-server/scripts/rd5/grant-capability.ts --key-hash <64-hex> --add <capability> [--apply]
 *        npx tsx services/mcp-server/scripts/rd5/grant-capability.ts --key-hash <64-hex> --remove-wildcard --expect <cap>[,<cap>...] [--apply]
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { runGrant, runRemoveWildcard } from "../../src/auth/rd5/grantCapability.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const keyHash = arg("--key-hash");
  const add = arg("--add");
  if (keyHash && process.argv.includes("--remove-wildcard")) {
    initializeApp();
    const expect = (arg("--expect") ?? "").split(",").filter(Boolean);
    const r = await runRemoveWildcard(getFirestore() as never, {
      keyHash, expect, apply: process.argv.includes("--apply"), arrayRemove: (...v: string[]) => FieldValue.arrayRemove(...v),
    });
    for (const l of r.lines) console.log(l);
    process.exit(r.ok ? 0 : 1);
  }
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
