import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { CASES, nextN, Ctx } from "./harness/cases";
import { denialNames, denied } from "./harness/judge";
import { knownOpen, probe } from "./harness/registry";

/**
 * N (A-11): every denial must name the true principal in quotes, and a call that is refused must be refused
 * loudly. Collected from the T2 matrix: every tool whose T2 probe is not known-open must answer subject `beta`
 * (called as alpha) with a denial that contains "alpha". A silent empty result or an anonymous denial fails.
 */
describe("N denials name the principal", () => {
  probe("N.denials_name_the_principal", async () => {
    const w = world();
    const open = knownOpen();
    const bad: string[] = [];
    let checked = 0;
    for (const k of CASES) {
      if (`T2.${k.id}` in open) continue;
      const c: Ctx = { w, subject: "beta", n: nextN() };
      await k.prepare?.(c);
      const r = await callTool(w, w.creds[k.cred ?? "scoped"], k.tool, k.args(c));
      checked++;
      if (!denialNames(r, "alpha")) bad.push(`${k.id}: ${denied(r) ? "denial does not name the principal" : "silent (no denial)"}`);
    }
    expect(checked).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});
