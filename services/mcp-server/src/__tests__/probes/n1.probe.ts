import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { denied } from "./harness/judge";
import * as fs from "fs";
import type { World } from "./harness/world";

/**
 * N1 (RD-5 PR-N1, plan section 22.1 item 3): when a call passes ONLY because the key holds "*" (the literal
 * capability is absent), the server writes one `authz_would_deny` line and the call still passes. The line counts the
 * capabilities a literal gate (PR-N) would refuse. Log only: every call below passes before and after this PR.
 */

/** The `authz_would_deny` lines the server wrote after byte offset `from`. */
const wouldDenyLines = (w: World, from: number): any[] =>
  fs.readFileSync(w.serverLog).subarray(from).toString("utf8").split("\n")
    .filter((l) => l.includes('"event":"authz_would_deny"'))
    .map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } })
    .filter(Boolean);
const logSize = (w: World): number => fs.statSync(w.serverLog).size;

describe("N1 authz_would_deny", () => {
  probe("N1.would_deny_logged", async () => {
    const w = world();
    const wild = await mint(w, "alpha", "probe-n1-wild", ["*"]);

    // per-tool gate (capabilities.ts hasCapability): dispatch_get_tasks needs dispatch.read, the key holds only "*"
    let from = logSize(w);
    let r = await callTool(w, wild, "dispatch_get_tasks", { requires_action: null });
    expect(denied(r)).toBe(false);
    expect(wouldDenyLines(w, from)).toEqual([
      { severity: "WARNING", event: "authz_would_deny", principal: "alpha", tool: "dispatch_get_tasks", capability: "dispatch.read", site: "capabilities.checkToolCapability:per_tool" },
    ]);

    // handler gate (gate.ts hasCapability): audit_get_audit logs at the per-tool gate and again at the handler
    from = logSize(w);
    r = await callTool(w, wild, "audit_get_audit", {});
    expect(denied(r)).toBe(false);
    const audit = wouldDenyLines(w, from);
    expect(audit.filter((l) => l.site === "gate.hasCapability")).toEqual([
      { severity: "WARNING", event: "authz_would_deny", principal: "alpha", tool: "audit_get_audit", capability: "audit.read", site: "gate.hasCapability" },
    ]);

    // unmapped tool (capabilities.ts): no TOOL_CAPABILITIES entry, passes only through "*"
    from = logSize(w);
    r = await callTool(w, wild, "dispatch_reap_expired_tasks", { dryRun: true });
    expect(denied(r)).toBe(false);
    expect(wouldDenyLines(w, from)).toEqual([
      { severity: "WARNING", event: "authz_would_deny", principal: "alpha", tool: "dispatch_reap_expired_tasks", capability: "unmapped", site: "capabilities.checkToolCapability:unmapped" },
    ]);
  });

  test("N1.would_deny_logged control: a key holding the literal capability beside \"*\" writes 0 lines", async () => {
    const w = world();
    const both = await mint(w, "alpha", "probe-n1-both", ["*", "dispatch.read", "audit.read"]);
    const from = logSize(w);
    const a = await callTool(w, both, "dispatch_get_tasks", { requires_action: null });
    const b = await callTool(w, both, "audit_get_audit", {});
    expect(denied(a)).toBe(false);
    expect(denied(b)).toBe(false);
    expect(wouldDenyLines(w, from)).toEqual([]);
  });
});
