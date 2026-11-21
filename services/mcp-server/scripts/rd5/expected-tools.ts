/**
 * RD-5 PR-N: prints, per key hash prefix, the number of tools that tools/list returns for a capability list.
 * Read-only: it reads keyIndex and writes nothing. The count is the literal filter of
 * filterToolsByCapabilities over TOOL_DEFINITIONS, so ISO pastes it beside the R11 counts before deploy.
 *
 * Usage: npx tsx services/mcp-server/scripts/rd5/expected-tools.ts <keyHashPrefix>...   (reads keyIndex, ADC)
 *        npx tsx services/mcp-server/scripts/rd5/expected-tools.ts --caps dispatch.read,relay.read   (no Firestore)
 */
import { filterToolsByCapabilities } from "../../src/middleware/capabilities.js";
import { TOOL_DEFINITIONS } from "../../src/tools/index.js";

/** The tools tools/list returns: defined tools whose capability the list holds by name. */
export function expectedToolCount(capabilities: readonly string[]): number {
  return filterToolsByCapabilities(TOOL_DEFINITIONS as { name: string }[], [...capabilities]).length;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--caps") {
    console.log(`${expectedToolCount((args[1] ?? "").split(",").filter(Boolean))} tools`);
    return;
  }
  if (args.length === 0) { console.error("usage: expected-tools.ts <keyHashPrefix>... | --caps a,b"); process.exit(2); }
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp();
  const snap = await getFirestore().collection("keyIndex").get();
  for (const prefix of args) {
    const docs = snap.docs.filter((d) => d.id.startsWith(prefix));
    if (docs.length !== 1) { console.log(`${prefix}: ${docs.length} matches, refusing`); continue; }
    const d = docs[0].data();
    const caps: string[] = Array.isArray(d.capabilities) ? d.capabilities.map(String) : [];
    console.log(`${prefix} ${d.programId ?? "?"}: ${expectedToolCount(caps)} tools`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
