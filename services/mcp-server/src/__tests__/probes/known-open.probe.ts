import { registered, knownOpen } from "./harness/registry";

/**
 * Runs after every other probe file (harness/sequencer.js). The set of probes written with `test.failing`
 * must equal known-open.json, and the list is printed so the job log carries it.
 */
describe("known-open registry", () => {
  test("the test.failing set equals known-open.json", () => {
    const failing = registered().filter((r) => r.failing).map((r) => r.id).sort();
    const listed = Object.keys(knownOpen()).sort();
    const all = registered().map((r) => r.id);
    expect(all.length).toBeGreaterThan(20); // the registry was actually populated
    expect(failing).toEqual(listed);
    // every listed id was declared by some probe (no stale entry), and each names the PR that closes it
    for (const [id, e] of Object.entries(knownOpen())) {
      expect({ id, declared: all.includes(id) }).toEqual({ id, declared: true });
      expect({ id, closes_in: typeof e.closes_in }).toEqual({ id, closes_in: "string" });
    }
    const lines = Object.entries(knownOpen()).map(([id, e]) => `  ${id.padEnd(36)} closes in ${e.closes_in.padEnd(10)} ${e.hole}`);
    console.log(`KNOWN-OPEN (${lines.length}):\n${lines.join("\n")}`);
  });
});
