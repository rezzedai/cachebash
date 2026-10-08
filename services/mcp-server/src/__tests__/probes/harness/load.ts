import * as fs from "fs";
import { WORLD_FILE_ENV, World } from "./world";

let cached: World | null = null;
export function world(): World {
  if (cached) return cached;
  const f = process.env[WORLD_FILE_ENV];
  if (!f) throw new Error("PROBE_WORLD_FILE not set: probes must run through jest.probes.config.js (globalSetup)");
  cached = JSON.parse(fs.readFileSync(f, "utf8")) as World;
  return cached;
}
