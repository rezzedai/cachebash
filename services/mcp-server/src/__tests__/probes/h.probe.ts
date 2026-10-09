import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { world } from "./harness/load";
import { callTool, listTools } from "./harness/client";
import { startServer, stopServer, RunningServer } from "./harness/server";
import { denied } from "./harness/judge";
import { probe } from "./harness/registry";
import type { World } from "./harness/world";

/**
 * H (A-1): with the server under AUTH_MODE=hybrid, a request carrying the program-override header must have
 * the same principal and capabilities as one without. The override is probed on a second server, started
 * in hybrid mode, because the main probe server runs under the shipped default (key_identity).
 */
describe("H override header", () => {
  let hybrid: RunningServer;
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd5-probes-hybrid-"));
    hybrid = await startServer({ authMode: "hybrid", logPath: path.join(dir, "server.log") });
  }, 90_000);
  afterAll(() => hybrid && stopServer(hybrid.pid));

  probe("H.override_changes_nothing", async () => {
    const w: World = { ...world(), baseUrl: hybrid.baseUrl };
    const cred = w.creds.scoped; // tenant A, program alpha
    const header = { "X-Program-Id": "beta" };
    // control: without the header alpha reads its own state and the tool list is non-trivial
    const own = await callTool(w, cred, "state_get_program_state", { programId: "alpha" });
    expect(own.json?.success).toBe(true);
    const plain = await listTools(w, cred);
    expect(plain.length).toBeGreaterThan(10);
    // same capabilities
    expect((await listTools(w, cred, "mcp", header)).sort()).toEqual(plain.sort());
    // same principal: a foreign read stays denied
    const foreign = await callTool(w, cred, "state_get_program_state", { programId: "beta" }, { headers: header });
    expect(denied(foreign)).toBe(true);
  });
});
