import * as fs from "fs";
import * as path from "path";
import type { AuthzSites } from "../../authz/types";

export const SRC_ROOT = path.resolve(__dirname, "..", "..");
export const DOCS_DIR = path.resolve(SRC_ROOT, "..", "docs");

export function loadSites(): AuthzSites {
  return JSON.parse(fs.readFileSync(path.join(DOCS_DIR, "authz-sites.json"), "utf8")) as AuthzSites;
}
