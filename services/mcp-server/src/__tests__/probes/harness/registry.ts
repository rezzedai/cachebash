import * as fs from "fs";
import * as path from "path";
import { WORLD_FILE_ENV } from "./world";

export interface KnownOpenEntry {
  /** the RD-5 PR that closes the hole, and removes this marker in the same commit */
  closes_in: string;
  /** one line: what the hole is */
  hole: string;
}

const KNOWN_OPEN_FILE = path.resolve(__dirname, "../known-open.json");

export function knownOpen(): Record<string, KnownOpenEntry> {
  return JSON.parse(fs.readFileSync(KNOWN_OPEN_FILE, "utf8"));
}

const registryFile = (): string => path.join(path.dirname(process.env[WORLD_FILE_ENV] as string), "registered.jsonl");

/**
 * Declare a probe. A probe listed in known-open.json is registered with `test.failing`: it passes while the
 * hole is open and FAILS THE JOB the moment the hole closes, which forces the closing PR to remove the marker.
 * Every declaration is recorded so known-open.probe.ts can require the two sets to be equal.
 */
export function probe(id: string, fn: () => Promise<void>, timeout?: number): void {
  const open = id in knownOpen();
  fs.appendFileSync(registryFile(), JSON.stringify({ id, failing: open }) + "\n");
  (open ? test.failing : test)(`${id}${open ? " [known-open]" : ""}`, fn, timeout);
}

export function registered(): { id: string; failing: boolean }[] {
  if (!fs.existsSync(registryFile())) return [];
  return fs.readFileSync(registryFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
