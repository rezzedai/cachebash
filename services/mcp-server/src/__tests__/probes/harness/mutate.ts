import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { MCP_SERVER_DIR } from "./server";

export const MUTATIONS_DIR = path.resolve(__dirname, "../mutations");

/** Probe id -> the probe file that declares it (the nested run only loads that file). */
export const PROBE_FILE: Record<string, string> = { T1: "t1.probe", T2: "t2.probe", T6: "t6.probe", B: "b.probe" };

export function patchFiles(): string[] {
  return fs.existsSync(MUTATIONS_DIR) ? fs.readdirSync(MUTATIONS_DIR).filter((f) => f.endsWith(".patch")).sort() : [];
}

const sh = (cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** A scratch copy of services/mcp-server (source only) with the real node_modules linked in, built incrementally. */
export class Scratch {
  dir: string;
  private tsc: string;
  constructor() {
    // inside services/mcp-server, so module resolution walks up to the same node_modules the real build uses
    this.dir = fs.mkdtempSync(path.join(MCP_SERVER_DIR, ".rd5-mutation-"));
    for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(MCP_SERVER_DIR, f), path.join(this.dir, f));
    fs.cpSync(path.join(MCP_SERVER_DIR, "src"), path.join(this.dir, "src"), { recursive: true });
    // the server under test needs no test files; skipping them makes each rebuild small
    fs.writeFileSync(path.join(this.dir, "tsconfig.mut.json"), JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { incremental: true, tsBuildInfoFile: "./.tsbuildinfo", declaration: false, declarationMap: false, sourceMap: false },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist", "src/__tests__"],
    }));
    this.tsc = require.resolve("typescript/bin/tsc");
  }
  dispose(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
  build(): { ok: boolean; out: string } {
    const r = sh(process.execPath, [this.tsc, "-p", "tsconfig.mut.json"], this.dir);
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  }
  apply(patch: string, reverse = false): { ok: boolean; out: string } {
    // not `git apply`: the scratch copy sits inside the repo, so git resolves patch paths against the repo root and
    // silently skips every file ("Skipped patch") while exiting 0. patch(1) fails loudly on any mismatch.
    const r = sh("patch", ["-p1", "-s", "--no-backup-if-mismatch", ...(reverse ? ["-R"] : []), "-i", path.join(MUTATIONS_DIR, patch)], this.dir);
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  }
  /** Run one probe (by id) against the patched build. Returns the names of the tests that failed. */
  runProbe(id: string): { failed: string[]; total: number; raw: string } {
    const outFile = path.join(this.dir, `result-${id}.json`);
    const env = { ...process.env, PROBE_NESTED: "1", PROBE_SERVER_DIR: this.dir } as NodeJS.ProcessEnv;
    delete env.PROBE_WORLD_FILE;
    const jest = require.resolve("jest/bin/jest");
    const file = PROBE_FILE[id.split(".")[0]];
    const r = sh(process.execPath, [
      jest, "--config", path.join(MCP_SERVER_DIR, "jest.probes.config.js"), "--json", `--outputFile=${outFile}`,
      "--testPathPattern", file, "-t", id.replace(/\./g, "\\."),
    ], MCP_SERVER_DIR, env);
    if (!fs.existsSync(outFile)) return { failed: ["<no result file>"], total: 0, raw: `${r.stdout}${r.stderr}` };
    const j = JSON.parse(fs.readFileSync(outFile, "utf8"));
    const tests = (j.testResults as any[]).flatMap((t) => t.assertionResults as any[]);
    return {
      failed: tests.filter((t) => t.status === "failed").map((t) => t.fullName as string),
      total: tests.filter((t) => t.status !== "pending").length,
      raw: "",
    };
  }
}
