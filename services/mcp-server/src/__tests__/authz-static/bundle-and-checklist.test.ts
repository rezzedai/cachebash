/**
 * RD-5 PR-C completeness surface (d) and the generated checklist.
 * serves_bundle_data is mandatory on every handler entry and every site record. Handlers that store
 * caller-keyed tenant data must cite the line where the tenant path segment is built, and that line
 * must read auth.userId only.
 */
import * as fs from "fs";
import * as path from "path";
import { bundleStatement, renderChecklist } from "../../authz/render";
import { DISPOSITIONS } from "../../authz/types";
import { DOCS_DIR, loadSites, SRC_ROOT } from "./load";

describe("authz-static (d): serves_bundle_data", () => {
  const doc = loadSites();

  test("serves_bundle_data is a boolean on every handler entry and site record", () => {
    for (const h of doc.handlers) expect({ tool: h.tool, v: typeof h.serves_bundle_data }).toEqual({ tool: h.tool, v: "boolean" });
    for (const s of doc.sites) expect({ id: s.id, v: typeof s.serves_bundle_data }).toEqual({ id: s.id, v: "boolean" });
  });

  test("no handler serves an ADR-015 bundle", () => {
    expect(doc.handlers.filter((h) => h.serves_bundle_data).map((h) => h.tool)).toEqual([]);
    expect(doc.sites.filter((s) => s.serves_bundle_data).map((s) => s.id)).toEqual([]);
  });

  test("the statement uses the ruled wording and never a bare 0 serve bundle data", () => {
    const text = bundleStatement(doc);
    expect(text).toMatch(/^110 handlers enumerated\. 0 serve ADR-015 bundles\. \d+ store caller-keyed tenant data, each partitioned by tenants\/\{auth\.userId\} at /);
    expect(text).not.toMatch(/0 serve bundle data/);
  });

  test("each caller-keyed handler cites lines that build the tenant segment from auth.userId only", () => {
    const keyed = doc.handlers.filter((h) => h.stores_caller_keyed_tenant_data);
    expect(keyed.map((h) => h.tool).sort()).toEqual(
      ["gsp_bootstrap", "gsp_diff", "gsp_propose", "gsp_read", "gsp_resolve", "gsp_search", "gsp_seed", "gsp_subscribe", "gsp_write", "state_update_program_state"]
    );
    const problems: string[] = [];
    for (const h of keyed) {
      if (!h.tenant_partition_cites?.length) problems.push(`${h.tool}: no cites`);
      for (const cite of h.tenant_partition_cites ?? []) {
        const [file, lineStr] = cite.split(":");
        const lines = fs.readFileSync(path.join(SRC_ROOT, file), "utf8").split("\n");
        const line = lines[Number(lineStr) - 1] ?? "";
        const ok = /tenants\/\$\{auth\.userId\}|gspCollectionPath\(auth\.userId|const userId = auth\.userId/.test(line);
        const fromArgs = /tenants\/\$\{(args|query|body|parsed|params|input)\./.test(line) || /gspCollectionPath\((args|parsed|query|body)\./.test(line);
        if (!ok || fromArgs) problems.push(`${h.tool}: ${cite} does not build the tenant segment from auth.userId: ${line.trim()}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("no tenant path in the gsp or program-state modules is built from an argument", () => {
    for (const f of ["modules/gsp.ts", "modules/programState.ts"]) {
      const text = fs.readFileSync(path.join(SRC_ROOT, f), "utf8");
      expect(text).not.toMatch(/tenants\/\$\{(args|query|body|parsed|params|input)\./);
      expect(text).not.toMatch(/gspCollectionPath\((args|parsed|query|body)\./);
    }
  });

  test("the bundle greps are recorded with their output", () => {
    expect(doc.bundle_greps).toHaveLength(3);
    for (const g of doc.bundle_greps) expect(g.cmd).toMatch(/^git grep .*-P /);
  });
});

describe("authz-static: records are well-formed", () => {
  const doc = loadSites();
  test("disposition is in the D-e vocabulary and ESCALATE records carry evidence and a recommendation", () => {
    for (const s of doc.sites) {
      expect(DISPOSITIONS).toContain(s.disposition);
      expect(s.evidence.length).toBeGreaterThan(10);
      if (s.disposition === "ESCALATE") expect({ id: s.id, rec: Boolean(s.recommendation) }).toEqual({ id: s.id, rec: true });
      expect(["pending", "done", "exempt"]).toContain(s.status);
    }
  });

  test("a site guarded by a name list is ESCALATE (C-5)", () => {
    const listed = doc.sites.filter((s) => s.name_lists.some((n) => doc.name_lists.find((l) => l.id === n && l.layer === "handler" || l.layer === "rest")));
    const bad = listed.filter((s) => s.disposition !== "ESCALATE" && s.disposition !== "NOT-IDENTITY").map((s) => s.id);
    expect(bad).toEqual([]);
  });

  test("every name_lists reference resolves", () => {
    const ids = new Set(doc.name_lists.map((n) => n.id));
    for (const s of doc.sites) for (const n of s.name_lists) expect(ids.has(n)).toBe(true);
    for (const h of doc.handlers) for (const n of h.name_lists) expect(ids.has(n)).toBe(true);
  });

  test("each name list still holds its members at its definition and is named at its guard sites", () => {
    const problems: string[] = [];
    const windowAt = (file: string, line: number): string => {
      const lines = fs.readFileSync(path.join(SRC_ROOT, file), "utf8").split("\n");
      return lines.slice(Math.max(0, line - 8), line + 8).join("\n");
    };
    for (const n of doc.name_lists) {
      if (n.members.length) {
        const w = windowAt(n.file, n.line);
        const missing = n.members.filter((m) => !w.includes(`"${m}"`));
        // lists that span several declarations (session compliance) are checked member-by-member in the file
        const wholeFile = fs.readFileSync(path.join(SRC_ROOT, n.file), "utf8");
        for (const m of missing) if (!wholeFile.includes(`"${m}"`)) problems.push(`${n.id}: member ${m} not in ${n.file}`);
      }
      const token = n.name.split(" ")[0];
      for (const site of n.guard_sites) {
        const [file, lineStr] = site.split(":");
        const w = windowAt(file, Number(lineStr));
        if (!w.includes(token) && !n.members.some((m) => w.includes(`"${m}"`))) problems.push(`${n.id}: neither ${token} nor a member near ${site}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the C-5 table third column is left for ISO", () => {
    const md = renderChecklist(doc);
    expect(md).toContain("| pending ISO |");
  });
});

describe("authz-static: generated checklist", () => {
  test("authz-enumeration-checklist.md equals the regenerated text", () => {
    const doc = loadSites();
    const committed = fs.readFileSync(path.join(DOCS_DIR, "authz-enumeration-checklist.md"), "utf8");
    expect(committed).toBe(renderChecklist(doc));
  });
});
