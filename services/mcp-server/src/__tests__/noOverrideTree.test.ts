/**
 * RD-5 PR-H: the program-override header, its parameter and its environment variable are deleted.
 * Greps every tracked file, case-insensitive, and requires zero hits. Each pattern is built from
 * fragments so this file does not match itself.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PATTERNS: Record<string, RegExp> = {
  header: new RegExp(["x", "program", "id"].join("-"), "i"),
  parameter: new RegExp(["program", "Id", "Override"].join(""), "i"),
  variable: new RegExp(["AUTH", "MODE"].join("_"), "i"),
};

function trackedFiles(): { root: string; files: string[] } {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: __dirname, encoding: "utf8" }).trim();
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { root, files: out.split("\0").filter(Boolean) };
}

describe("override surface is gone from the whole tree", () => {
  const { root, files } = trackedFiles();

  it("lists a populated tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const [name, re] of Object.entries(PATTERNS)) {
    it(`zero hits for the ${name} name`, () => {
      const hits: string[] = [];
      for (const f of files) {
        const full = path.join(root, f);
        let text: string;
        try {
          if (!fs.statSync(full).isFile()) continue;
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        text.split("\n").forEach((line, i) => {
          if (re.test(line)) hits.push(`${f}:${i + 1}`);
        });
      }
      expect({ name, hits }).toEqual({ name, hits: [] });
    });
  }
});
