import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import { assertEmulatorOnly } from "./guard";

export interface RunningServer {
  baseUrl: string;
  child: ChildProcess;
  pid: number;
  logPath: string;
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

/** Repo's services/mcp-server directory (this file is src/__tests__/probes/harness/server.ts). */
export const MCP_SERVER_DIR = path.resolve(__dirname, "../../../..");

/**
 * Start the BUILT server (dist/index.js) as a child process against the emulator.
 * No production code is changed or switched: the server reads FIREBASE_PROJECT_ID and the
 * Firestore admin SDK honours FIRESTORE_EMULATOR_HOST.
 */
export async function startServer(opts: {
  serverDir?: string;
  authMode: string;
  logPath: string;
}): Promise<RunningServer> {
  const target = assertEmulatorOnly();
  const dir = opts.serverDir ?? MCP_SERVER_DIR;
  const port = await freePort();
  const fs = await import("fs");
  const out = fs.openSync(opts.logPath, "a");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    PORT: String(port),
    FIREBASE_PROJECT_ID: target.projectId,
    GCLOUD_PROJECT: target.projectId,
    FIRESTORE_EMULATOR_HOST: target.emulatorHost,
    AUTH_MODE: opts.authMode,
  };
  const child = spawn(process.execPath, [path.join(dir, "dist/index.js")], {
    cwd: dir,
    env, // deliberately NOT process.env: no ambient credentials reach the server
    stdio: ["ignore", out, out],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}); see ${opts.logPath}`);
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`server did not become healthy in 60s; see ${opts.logPath}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { baseUrl, child, pid: child.pid!, logPath: opts.logPath };
}

export function stopServer(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
