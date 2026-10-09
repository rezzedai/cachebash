import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { assertEmulatorOnly } from "./guard";
import { clearEmulator } from "./emulator";
import { seedAll } from "./seed";
import { startServer } from "./server";
import { seedData } from "./data";
import { WORLD_FILE_ENV, World } from "./world";

/** Runs once before the whole corpus. The production-refusal assertion is the first thing that happens. */
export default async function globalSetup(): Promise<void> {
  const target = assertEmulatorOnly(); // before any seeding, before any server start
  await clearEmulator();
  const { tenants, creds, seeders } = await seedAll();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd5-probes-"));
  const authMode = process.env.PROBE_AUTH_MODE || "key_identity";
  const serverDir = process.env.PROBE_SERVER_DIR || undefined;
  const srv = await startServer({ serverDir, authMode, logPath: path.join(dir, "server.log") });

  const seed = await seedData({ baseUrl: srv.baseUrl }, seeders);

  const world: World = {
    baseUrl: srv.baseUrl,
    serverPid: srv.pid,
    serverDir: serverDir ?? "",
    authMode,
    projectId: target.projectId,
    emulatorHost: target.emulatorHost,
    tenants,
    creds,
    seeders,
    seed,
  };
  const file = path.join(dir, "world.json");
  fs.writeFileSync(file, JSON.stringify(world), { mode: 0o600 });
  process.env[WORLD_FILE_ENV] = file;
  console.log(`[probes] server ${srv.baseUrl} pid ${srv.pid} authMode=${authMode} world=${file}`);
}
