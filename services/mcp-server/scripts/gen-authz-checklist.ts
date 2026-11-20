/**
 * Renders docs/authz-enumeration-checklist.md from docs/authz-sites.json.
 * Logic lives in src/authz/ so Jest can exercise it (tsconfig rootDir is ./src).
 *
 *   npx tsx scripts/gen-authz-checklist.ts          write the checklist
 *   npx tsx scripts/gen-authz-checklist.ts --check  exit 1 if the committed file differs
 */
import * as fs from "fs";
import * as path from "path";
import { renderChecklist } from "../src/authz/render";
import type { AuthzSites } from "../src/authz/types";

const docs = path.resolve(__dirname, "..", "docs");
const doc = JSON.parse(fs.readFileSync(path.join(docs, "authz-sites.json"), "utf8")) as AuthzSites;
const out = path.join(docs, "authz-enumeration-checklist.md");
const text = renderChecklist(doc);

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error("authz-enumeration-checklist.md differs from authz-sites.json; run without --check");
    process.exit(1);
  }
  console.log("authz-enumeration-checklist.md matches authz-sites.json");
} else {
  fs.writeFileSync(out, text);
  console.log(`wrote ${out} (${text.length} bytes)`);
}
