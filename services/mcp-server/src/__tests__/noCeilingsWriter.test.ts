/**
 * RD-5 PR-G (R9, C-3): no file in src/ writes tenants/{org}/_meta/ceilings, so no agent-held
 * API credential can set or clear `paused` or `dispatchPaused`.
 * Known hole (plan section 13): a process holding Firestore ADC can still write it directly.
 * Test files under src/__tests__ seed the emulator and are excluded; they are not shipped.
 */
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "..");
const WRITE_CALL = /\.(set|update|create|delete)\s*\(|\.(batch|runTransaction)\s*\(|\bFieldValue\b/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|js)$/.test(e.name) ? [p] : [];
  });
}

describe("no writer of _meta/ceilings in src/", () => {
  const files = sourceFiles(SRC);

  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(50);
    // control: the reader is found, so the scan would see a reference to the document
    expect(files.some((f) => f.endsWith(path.join("middleware", "circuitBreaker.ts")))).toBe(true);
  });

  it("no src file that names the ceilings document also performs a write call", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const mentions = /_meta\/ceilings|_meta["'`]\s*\)?\s*\.doc\(\s*["'`]ceilings|["'`]ceilings["'`]/.test(text);
      // the breaker's in-memory Map counters also use .set/.delete; they are not Firestore
      const withoutMaps = text.replace(/\b(keyWindows|orgWindows|store)\.(set|delete)\(/g, "");
      if (mentions && WRITE_CALL.test(withoutMaps)) offenders.push(path.relative(SRC, f));
    }
    expect(offenders).toEqual([]);
  });

  it("the only src file that names the ceilings document is the breaker, and it only reads", () => {
    const naming = files.filter((f) => /_meta\/ceilings/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
    expect(naming).toEqual([path.join("middleware", "circuitBreaker.ts")]);
  });

  it("no src file writes through a computed _meta path or the dispatchPaused/paused field", () => {
    const offenders = files.filter((f) => {
      const t = fs.readFileSync(f, "utf8");
      return /\bdispatchPaused\b\s*:/.test(t) && f !== path.join(SRC, "middleware", "circuitBreaker.ts");
    }).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
