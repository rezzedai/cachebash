import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { CASES, nextN, Ctx } from "./harness/cases";
import { probe } from "./harness/registry";

/**
 * T2: for every tool that takes an identifier argument, `scoped` (tenant A, program alpha) naming subject
 * `beta` must not reach beta's data or change beta's state. Each deny assertion has an allow twin: the same
 * request shape with subject `alpha` must reach alpha's seeded data, so a probe cannot pass on an empty database.
 */
describe("T2 identifier-argument tools", () => {
  for (const k of CASES) {
    const run = async (subject: "alpha" | "beta") => {
      const w = world();
      const c: Ctx = { w, subject, n: nextN() };
      await k.prepare?.(c);
      const r = await callTool(w, w.creds[k.cred ?? "scoped"], k.tool, k.args(c));
      const reached = await k.reached(c, r);
      await k.cleanup?.(c);
      last = r.text.slice(0, 300);
      return reached;
    };
    let last = "";
    probe(`T2.${k.id}`, async () => {
      expect(await run("beta")).toBe(false);
    });
    test(`T2.${k.id} control: own subject reaches seeded data`, async () => {
      const reached = await run("alpha");
      expect({ reached, response: last }).toMatchObject({ reached: true });
    });
  }
});
