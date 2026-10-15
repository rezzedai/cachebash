/**
 * RD-5 PR-A: /v1/health build identity helper.
 * Pure helper, no server boot, no Firestore.
 */

import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { resolveBuildIdentity } from "../utils/buildInfo";

const KEYS = ["revision", "service", "gitSha", "buildTime"].sort();

describe("resolveBuildIdentity", () => {
  let dir: string;
  let goodFile: string;
  let badFile: string;
  const missingFile = () => path.join(dir, "absent.json");

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "build-info-"));
    goodFile = path.join(dir, "good.json");
    badFile = path.join(dir, "bad.json");
    writeFileSync(goodFile, JSON.stringify({ gitSha: "abc123", buildTime: "2026-10-08T12:00:00Z" }));
    writeFileSync(badFile, "{ not json");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fullEnv = { K_REVISION: "cachebash-mcp-00042-xyz", K_SERVICE: "cachebash-mcp" };

  it("returns all four non-empty keys in every env/file combination", () => {
    for (const env of [{}, fullEnv]) {
      for (const file of [goodFile, badFile, missingFile()]) {
        const out = resolveBuildIdentity(env, file);
        expect(Object.keys(out).sort()).toEqual(KEYS);
        for (const v of Object.values(out)) {
          expect(typeof v).toBe("string");
          expect(v.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses env and file values when present", () => {
    expect(resolveBuildIdentity(fullEnv, goodFile)).toEqual({
      revision: "cachebash-mcp-00042-xyz",
      service: "cachebash-mcp",
      gitSha: "abc123",
      buildTime: "2026-10-08T12:00:00Z",
    });
  });

  it("yields unknown for everything when env and file are both absent", () => {
    expect(resolveBuildIdentity({}, missingFile())).toEqual({
      revision: "unknown", service: "unknown", gitSha: "unknown", buildTime: "unknown",
    });
  });

  it("treats empty-string env as unknown", () => {
    const out = resolveBuildIdentity(
      { K_REVISION: "", K_SERVICE: "  ", GIT_SHA: "", BUILD_TIME: "" }, missingFile());
    expect(out).toEqual({ revision: "unknown", service: "unknown", gitSha: "unknown", buildTime: "unknown" });
  });

  it("does not throw on a malformed file and falls back to unknown", () => {
    expect(() => resolveBuildIdentity(fullEnv, badFile)).not.toThrow();
    const out = resolveBuildIdentity(fullEnv, badFile);
    expect(out.gitSha).toBe("unknown");
    expect(out.buildTime).toBe("unknown");
    expect(out.revision).toBe("cachebash-mcp-00042-xyz");
  });

  it("treats a file with empty or non-string fields as unknown, and falls back per field to GIT_SHA/BUILD_TIME env", () => {
    const f = path.join(dir, "partial.json");
    writeFileSync(f, JSON.stringify({ gitSha: "", buildTime: 5 }));
    expect(resolveBuildIdentity({}, f)).toMatchObject({ gitSha: "unknown", buildTime: "unknown" });
    expect(resolveBuildIdentity({ GIT_SHA: "envsha", BUILD_TIME: "envtime" }, f))
      .toMatchObject({ gitSha: "envsha", buildTime: "envtime" });
    // file wins over env
    expect(resolveBuildIdentity({ GIT_SHA: "envsha" }, goodFile).gitSha).toBe("abc123");
  });

  it("treats non-object JSON as unknown", () => {
    const f = path.join(dir, "arr.json");
    writeFileSync(f, "[1,2]");
    expect(resolveBuildIdentity({}, f).gitSha).toBe("unknown");
    writeFileSync(f, "null");
    expect(resolveBuildIdentity({}, f).gitSha).toBe("unknown");
  });
});
