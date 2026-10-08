import * as fs from "fs";
import * as path from "path";
import { stopServer } from "./server";
import { WORLD_FILE_ENV, World } from "./world";

export default async function globalTeardown(): Promise<void> {
  const file = process.env[WORLD_FILE_ENV];
  if (!file || !fs.existsSync(file)) return;
  const world: World = JSON.parse(fs.readFileSync(file, "utf8"));
  stopServer(world.serverPid);
  fs.rmSync(path.dirname(file), { recursive: true, force: true }); // removes the per-run keys
}
