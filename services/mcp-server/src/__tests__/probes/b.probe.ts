import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { denialNames } from "./harness/judge";
import { probe } from "./harness/registry";

/**
 * B (A-4): gsp_bootstrap. `scoped` stands in for the plan's `restricted` and `observer` carries gsp.write,
 * because gsp_bootstrap is mapped to gsp.write, which the wingman preset does not hold.
 */
describe("B bootstrap memory", () => {
  probe("B.self_returns_memory", async () => {
    const w = world();
    const r = await callTool(w, w.creds.scoped, "gsp_bootstrap", { agentId: "alpha", depth: "standard" });
    expect(r.json?.success).toBe(true);
    // in the memory block itself, not anywhere in the payload (other sections can echo seeded strings)
    expect(r.json.payload.memory.omitted).not.toBe(true);
    expect(JSON.stringify(r.json.payload.memory)).toContain("mk-A-alpha"); // alpha's seeded memory pattern
  });

  probe("B.foreign_denied", async () => {
    const w = world();
    const own = await callTool(w, w.creds.scoped, "gsp_bootstrap", { agentId: "alpha" });
    expect(own.json?.success).toBe(true); // control: same request shape, own subject
    const r = await callTool(w, w.creds.scoped, "gsp_bootstrap", { agentId: "beta" });
    expect(r.json?.success).toBe(false);
    expect(denialNames(r, "alpha")).toBe(true);
    expect(r.text).not.toContain("mk-A-beta");
  });

  probe("B.observer_gets_no_memory", async () => {
    const w = world();
    const r = await callTool(w, w.creds.observer, "gsp_bootstrap", { agentId: "alpha", depth: "full" });
    expect(r.json?.success).toBe(true); // fleet.observe widens the read
    expect(r.json?.payload?.identity).toBeDefined(); // control: the rest of the payload is there
    expect(r.json.payload.memory.omitted).toBe(true);
    expect(JSON.stringify(r.json.payload.memory)).not.toContain("mk-A-alpha"); // and none of alpha's memory (the pending-task section legitimately carries seeded titles)
  });

  probe("B.typed_memory_status", async () => {
    const w = world();
    const self = await callTool(w, w.creds.scoped, "gsp_bootstrap", { agentId: "alpha" });
    const foreign = await callTool(w, w.creds.observer, "gsp_bootstrap", { agentId: "alpha" });
    expect(self.json?.payload?.memory?.status).toBe("loaded");
    expect(foreign.json?.payload?.memory?.status).toBe("omitted");
  });
});
