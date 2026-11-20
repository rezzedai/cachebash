import { world } from "./harness/load";
import { callTool, listTools } from "./harness/client";
import { denied } from "./harness/judge";
import { probe } from "./harness/registry";

/**
 * H (A-1): a request carrying a program-naming header must have the same principal and capabilities as one
 * without. Identity comes from the credential only. The header name is built from fragments so no file in
 * the tree spells it (the zero-hit test in noOverrideTree.test.ts greps for it).
 */
describe("H override header", () => {
  probe("H.override_changes_nothing", async () => {
    const w = world();
    const cred = w.creds.scoped; // tenant A, program alpha
    const header = { [["X", "Program", "Id"].join("-")]: "beta" };
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
