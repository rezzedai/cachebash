/**
 * RD-5 PR-C completeness surface (b): every tool in the registry and in ISO_TOOL_HANDLERS has a
 * handler entry. A new tool cannot ship unenumerated.
 *
 * ISO_TOOL_HANDLERS is not exported from iso/isoServer.ts and PR-C may not change a runtime file,
 * so its keys are read from the source with the TypeScript parser.
 */
import * as ts from "typescript";
import * as path from "path";
import { parseFile } from "../../authz/scan";
import { loadSites, SRC_ROOT } from "./load";

// @octokit/rest is ESM-only; other suites mock the module that imports it.
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));
jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn(), getApps: jest.fn(() => []), cert: jest.fn(), applicationDefault: jest.fn() }));
// Module-load code calls Timestamp.fromDate and similar; any member is a stub.
jest.mock("firebase-admin/firestore", () => {
  const stubs = new Proxy({}, { get: () => jest.fn() });
  return { getFirestore: jest.fn(() => ({})), FieldValue: stubs, Timestamp: stubs };
});

function isoHandlerKeys(): string[] {
  const sf = parseFile(SRC_ROOT, "iso/isoServer.ts");
  const keys: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "ISO_TOOL_HANDLERS" && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) keys.push(p.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return keys;
}

describe("authz-static (b): registry completeness", () => {
  const doc = loadSites();
  const entries = new Map(doc.handlers.map((h) => [h.tool, h]));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TOOL_HANDLERS, TOOL_DEFINITIONS } = require("../../tools/index") as {
    TOOL_HANDLERS: Record<string, unknown>;
    TOOL_DEFINITIONS: Array<{ name: string }>;
  };

  test("TOOL_HANDLERS has 110 keys in the default profile and the JSON counts them", () => {
    expect(Object.keys(TOOL_HANDLERS)).toHaveLength(110);
    expect(doc.handlers.filter((h) => h.profile === "full")).toHaveLength(110);
  });

  test("every registered handler has an entry", () => {
    expect(Object.keys(TOOL_HANDLERS).filter((t) => !entries.has(t))).toEqual([]);
  });

  test("every tool definition has an entry", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name).filter((t) => !entries.has(t))).toEqual([]);
    expect(TOOL_DEFINITIONS).toHaveLength(107);
  });

  test("the three handlers without a definition are the usage tools", () => {
    const defs = new Set(TOOL_DEFINITIONS.map((d) => d.name));
    expect(Object.keys(TOOL_HANDLERS).filter((t) => !defs.has(t)).sort()).toEqual(["usage_get_invoice", "usage_get_usage", "usage_set_budget"]);
  });

  test("every ISO_TOOL_HANDLERS key has an entry marked iso", () => {
    const keys = isoHandlerKeys();
    expect(keys).toHaveLength(19);
    expect(keys.filter((k) => !entries.has(k) || !entries.get(k)!.transports.includes("iso"))).toEqual([]);
  });

  test("every entry is in the registry, except the lite-profile tool", () => {
    const stale = doc.handlers.filter((h) => h.profile === "full" && !(h.tool in TOOL_HANDLERS)).map((h) => h.tool);
    expect(stale).toEqual([]);
    expect(doc.handlers.filter((h) => h.profile === "lite").map((h) => h.tool)).toEqual(["request_help"]);
  });

  test("entry file and handler names exist in the module source", () => {
    const problems: string[] = [];
    for (const h of doc.handlers) {
      const sf = parseFile(SRC_ROOT, h.file);
      const re = new RegExp(`\\b${h.handler}\\b`);
      if (!re.test(sf.text)) problems.push(`${h.tool}: ${h.handler} not in ${h.file}`);
    }
    expect(problems).toEqual([]);
    expect(path.basename(SRC_ROOT)).toBe("src");
  });
});
