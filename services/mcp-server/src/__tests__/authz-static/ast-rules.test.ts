/**
 * RD-5 PR-C completeness surface (c): the D-f AST rules S1 to S3 over non-test src/ with a
 * shrinking baseline recorded in authz-sites.json as status "pending".
 * Positive control: three fixture files, one violation each; the test fails if the checker
 * does not flag all three.
 */
import * as path from "path";
import { buildSrcProgram, checkProgram, groupViolations } from "../../authz/rules";
import { loadSites, SRC_ROOT } from "./load";

const FIXTURES = ["s1", "s2", "s3"].map((n) => path.join(__dirname, "fixtures", `${n}.fixture.ts`));

describe("authz-static (c): AST rules", () => {
  const doc = loadSites();
  const { program, files } = buildSrcProgram(SRC_ROOT, FIXTURES);
  const rel = (abs: string): string => path.relative(SRC_ROOT, abs).split(path.sep).join("/");

  test("positive control: each fixture is flagged by exactly its rule", () => {
    const vs = checkProgram(program, FIXTURES, (abs) => path.basename(abs));
    const got = vs.map((v) => `${v.file}:${v.rule}`).sort();
    expect(got).toEqual(["s1.fixture.ts:S1", "s2.fixture.ts:S2", "s3.fixture.ts:S3"]);
  });

  const current = groupViolations(checkProgram(program, files, rel));
  const key = (r: { rule: string; file: string; handler: string; expr: string }): string => [r.rule, r.file, r.handler, r.expr].join("|");

  test("every violation is recorded in the baseline with the same occurrence count", () => {
    const recorded = new Map(doc.ast_baseline.map((r) => [key(r), r]));
    const problems = current
      .filter((c) => recorded.get(key(c))?.occurrences !== c.occurrences)
      .map((c) => `${key(c)} x${c.occurrences} (baseline ${recorded.get(key(c))?.occurrences ?? "none"})`);
    expect(problems).toEqual([]);
  });

  test("every baseline row still matches a violation (the baseline only shrinks)", () => {
    const live = new Set(current.map(key));
    expect(doc.ast_baseline.filter((r) => !live.has(key(r))).map(key)).toEqual([]);
  });

  test("baseline rows are pending", () => {
    expect(doc.ast_baseline.filter((r) => r.status !== "pending")).toEqual([]);
  });

  // RD-5 PR-N N-D4: the S1 rows are gone with the field. The S1 rule stays as a backstop: the fixture above still trips it.
  test("no S1 row remains in the baseline", () => {
    expect(doc.ast_baseline.filter((r) => r.rule === "S1")).toEqual([]);
  });
});
