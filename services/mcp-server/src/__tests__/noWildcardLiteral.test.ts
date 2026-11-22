import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * RD-5 PR-N N-D1: no code path names the wildcard. A string literal of one asterisk in non-test src fails this test,
 * except the single constant in auth/rd5/grantCapability.ts (what a grant refuses and the narrow removes). Comments are not literals.
 */
const SRC = path.resolve(__dirname, "..");
const ALLOWED = new Set(["auth/rd5/grantCapability.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(full, out); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("no wildcard string literal in non-test src", () => {
  it("finds no \"*\" literal outside the allowed constant", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
      const visit = (n: ts.Node): void => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === "*" && !ALLOWED.has(rel)) {
          hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });

  it("the allowed file holds exactly one", () => {
    const text = fs.readFileSync(path.join(SRC, "auth/rd5/grantCapability.ts"), "utf8");
    expect(text.split("\n").filter((l) => l.includes('"*"') && !l.trim().startsWith("*") && !l.trim().startsWith("//"))).toHaveLength(1);
  });

  it("WILDCARD_EQUIVALENT is the sorted distinct TOOL_CAPABILITIES values and DEFAULT_CAPABILITIES never holds the wildcard", () => {
    jest.isolateModules(() => {
      const c = require("../middleware/capabilities");
      expect(c.WILDCARD_EQUIVALENT).toEqual([...new Set(Object.values(c.TOOL_CAPABILITIES))].sort());
      for (const [role, caps] of Object.entries(c.DEFAULT_CAPABILITIES) as [string, string[]][]) {
        expect({ role, wildcard: caps.includes("*") }).toEqual({ role, wildcard: false });
      }
    });
  });
});
