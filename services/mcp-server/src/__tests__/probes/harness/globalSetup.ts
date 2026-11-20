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
  // a mutation-control run (mutations.probe.ts) is nested inside a live run and must not wipe the outer run's data;
  // every tenant uid is random, so a nested run cannot collide with it
  if (!process.env.PROBE_NESTED) await clearEmulator();
  const { tenants, creds, seeders, stateSeeders } = await seedAll();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd5-probes-"));
  const serverDir = process.env.PROBE_SERVER_DIR || undefined;
  const srv = await startServer({ serverDir, logPath: path.join(dir, "server.log") });

  const seed = await seedData({ baseUrl: srv.baseUrl }, seeders, stateSeeders);

  const world: World = {
    baseUrl: srv.baseUrl,
    serverPid: srv.pid,
    serverLog: srv.logPath,
    serverDir: serverDir ?? "",
    projectId: target.projectId,
    emulatorHost: target.emulatorHost,
    tenants,
    creds,
    seeders,
    stateSeeders,
    seed,
  };
  const file = path.join(dir, "world.json");
  fs.writeFileSync(file, JSON.stringify(world), { mode: 0o600 });
  process.env[WORLD_FILE_ENV] = file;
  console.log(`[probes] server ${srv.baseUrl} pid ${srv.pid} world=${file}`);
}
