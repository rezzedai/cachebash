/**
 * RD-5 key inventory. Read-only: writes nothing.
 * Usage: npx tsx services/mcp-server/scripts/rd5/key-inventory.ts
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runKeyInventory } from "../../src/auth/rd5/keyInventory.js";

async function main() {
  initializeApp();
  const lines = await runKeyInventory(getFirestore() as never);
  for (const l of lines) console.log(l);
  console.log(`\n${lines.length} keyIndex documents`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
