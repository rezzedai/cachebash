import { patchFiles, Scratch } from "./harness/mutate";
import { knownOpen, registered } from "./harness/registry";

/**
 * Mutation control. For every probe that passes (is not in known-open.json) there is a patch under
 * mutations/ that reintroduces the hole in src/. Each patch is applied to a scratch copy, the copy is rebuilt,
 * that one probe is run against it, and the probe must go RED. A patch that no longer applies fails the job.
 * (For a known-open probe the live red is the control; the PR that closes the hole adds its patch.)
 * Runs after every other probe file (harness/sequencer.js).
 */
const patches = patchFiles();
const idOf = (f: string) => f.replace(/\.patch$/, "");

describe("mutation control", () => {
  let scratch: Scratch;
  afterAll(() => scratch?.dispose());
  beforeAll(() => {
    scratch = new Scratch();
    const b = scratch.build();
    if (!b.ok) throw new Error(`scratch build of the unpatched tree failed:\n${b.out.slice(0, 2000)}`);
  }, 240_000);

  test("every passing probe has a mutation patch, and every patch names a registered passing probe", () => {
    const passing = registered().filter((r) => !r.failing).map((r) => r.id).sort();
    const have = patches.map(idOf).sort();
    expect({ missingPatch: passing.filter((p) => !have.includes(p)) }).toEqual({ missingPatch: [] });
    expect({ stalePatch: have.filter((p) => !passing.includes(p)) }).toEqual({ stalePatch: [] });
    expect({ patchForKnownOpen: have.filter((p) => p in knownOpen()) }).toEqual({ patchForKnownOpen: [] });
  });

  for (const f of patches) {
    const id = idOf(f);
    test(`MUTATION-CONTROL ${id}`, async () => {
      const a = scratch.apply(f);
      expect({ patch: f, applies: a.ok, why: a.ok ? "" : a.out }).toEqual({ patch: f, applies: true, why: "" });
      try {
        const b = scratch.build();
        expect({ patch: f, builds: b.ok, why: b.ok ? "" : b.out.slice(0, 1500) }).toEqual({ patch: f, builds: true, why: "" });
        const r = scratch.runProbe(id);
        const red = r.failed.filter((n) => n.includes(id) && !n.includes(" control:"));
        // eslint-disable-next-line no-console
        console.log(`MUTATION-CONTROL ${id}: with ${f} applied the probe went ${red.length ? "RED" : "GREEN (NOT CAUGHT)"} (${r.failed.length} of ${r.total} tests failed)`);
        expect({ id, wentRed: red.length > 0 }).toEqual({ id, wentRed: true });
      } finally {
        scratch.apply(f, true);
      }
    }, 300_000);
  }
});
