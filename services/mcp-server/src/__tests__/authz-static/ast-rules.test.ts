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

  // RD-5 PR-N N-D7: the baseline is empty. Every S1 to S3 violation must be in ast_reviewed, which names a PR and a reason.
  const reviewed = (doc as unknown as { ast_reviewed: { rule: string; file: string; handler: string; expr: string; pr: string; reason: string }[] }).ast_reviewed;

  test("the baseline is empty", () => {
    expect(doc.ast_baseline).toEqual([]);
  });

  test("every violation is a reviewed row with the same key", () => {
    const rev = new Set(reviewed.map(key));
    expect(current.filter((c) => !rev.has(key(c))).map(key)).toEqual([]);
  });

  test("every reviewed row still matches a violation and names a PR and a reason", () => {
    const live = new Set(current.map(key));
    expect(reviewed.filter((r) => !live.has(key(r))).map(key)).toEqual([]);
    for (const r of reviewed) expect({ key: key(r), pr: r.pr.length > 0, reason: r.reason.length > 10 }).toEqual({ key: key(r), pr: true, reason: true });
    expect(reviewed).toHaveLength(5);
  });

  // RD-5 PR-N N-D4: the S1 rows are gone with the field. The S1 rule stays as a backstop: the fixture above still trips it.
  test("no S1 row remains in the baseline", () => {
    expect(doc.ast_baseline.filter((r) => r.rule === "S1")).toEqual([]);
  });
});
