/**
 * RD-5 PR-C completeness surface (a): regexes a, b, c over src/ against authz-sites.json.
 * Every hit owns a record and every record owns a hit (records with regex "none" are
 * checked in invisible-classes.test.ts).
 */
import { groupHits, scanSrc, siteKey } from "../../authz/scan";
import { loadSites, SRC_ROOT } from "./load";

describe("authz-static (a): regex hits and site records", () => {
  const doc = loadSites();
  const hits = scanSrc(SRC_ROOT);
  const groups = groupHits(hits);
  const regexRecords = doc.sites.filter((s) => s.regex !== "none");

  test("every regex hit group has a record", () => {
    const keyed = new Set(regexRecords.map((s) => `${siteKey(s.file, s.handler, s.expr)}|${s.regex}`));
    const missing = groups
      .filter((g) => !keyed.has(`${siteKey(g.file, g.handler, g.expr)}|${g.regex}`))
      .map((g) => `${g.regex} ${g.file} ${g.handler} ${g.expr} x${g.occurrences} line ${g.line_at_base}`);
    expect(missing).toEqual([]);
  });

  test("every regex record has a hit, with matching occurrences", () => {
    const byKey = new Map(groups.map((g) => [`${siteKey(g.file, g.handler, g.expr)}|${g.regex}`, g]));
    const problems: string[] = [];
    for (const s of regexRecords) {
      const g = byKey.get(`${siteKey(s.file, s.handler, s.expr)}|${s.regex}`);
      if (!g) problems.push(`no hit for ${s.id}`);
      else if (g.occurrences !== s.occurrences) problems.push(`${s.id}: record says ${s.occurrences}, scan found ${g.occurrences}`);
    }
    expect(problems).toEqual([]);
  });

  test("record ids are unique", () => {
    const ids = doc.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("recorded counts equal the scan at the base", () => {
    const a = hits.filter((h) => h.regex === "a");
    const bLines = new Set(hits.filter((h) => h.regex === "b").map((h) => `${h.file}:${h.line}`));
    const c = hits.filter((h) => h.regex === "c");
    const rc = doc.regex_counts;
    expect({
      a_occurrences: a.length,
      a_lines: new Set(a.map((h) => `${h.file}:${h.line}`)).size,
      a_files: new Set(a.map((h) => h.file)).size,
      b_lines_beyond_a: bLines.size,
      c_lines: c.length,
    }).toEqual({
      a_occurrences: rc.a_occurrences,
      a_lines: rc.a_lines,
      a_files: rc.a_files,
      b_lines_beyond_a: rc.b_lines_beyond_a,
      c_lines: rc.c_lines,
    });
  });

  test("the three regex commands are recorded as git grep -P", () => {
    for (const k of ["a", "b", "c"] as const) {
      expect(doc.regex_commands[k]).toMatch(/^git grep -n (-o )?-P /);
      expect(doc.regex_commands[k]).not.toMatch(/ -E /);
    }
  });
});
