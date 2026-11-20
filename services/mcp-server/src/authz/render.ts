/**
 * RD-5 PR-C: renders docs/authz-enumeration-checklist.md from docs/authz-sites.json.
 * Pure function of the JSON, so a test can regenerate and diff.
 */
import { AuthzSites, DISPOSITIONS, SiteRecord } from "./types";

const cell = (s: string | number | boolean | null | undefined): string =>
  String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const code = (s: string): string => "`" + s.replace(/`/g, "'") + "`";

export function countByDisposition(sites: SiteRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of DISPOSITIONS) out[d] = 0;
  for (const s of sites) out[s.disposition] += 1;
  return out;
}

/**
 * The R6 statement, in the wording VECTOR ruled (kCAh8BiR): never a bare "0 serve bundle data".
 * N counts the default-profile registry; K lists every handler storing caller-keyed tenant data.
 */
export function bundleStatement(doc: AuthzSites): string {
  const full = doc.handlers.filter((h) => h.profile === "full");
  const serving = full.filter((h) => h.serves_bundle_data).length;
  const keyed = doc.handlers.filter((h) => h.stores_caller_keyed_tenant_data);
  const at = keyed.map((h) => `${h.tool} at ${(h.tenant_partition_cites ?? []).join(", ")}`).join("; ");
  return `${full.length} handlers enumerated. ${serving} serve ADR-015 bundles. ${keyed.length} store caller-keyed tenant data, each partitioned by tenants/{auth.userId} at ${at}.`;
}

export function renderChecklist(doc: AuthzSites): string {
  const L: string[] = [];
  const counts = countByDisposition(doc.sites);
  const lite = doc.handlers.filter((h) => h.profile === "lite");

  L.push("# Authorization call-site enumeration (RD-5 PR-C)");
  L.push("");
  L.push("GENERATED from `docs/authz-sites.json` by `scripts/gen-authz-checklist.ts`. Do not edit by hand.");
  L.push("A test regenerates this file and fails on any difference. Edit the JSON, then run");
  L.push("`npx tsx scripts/gen-authz-checklist.ts` from `services/mcp-server`.");
  L.push("");
  L.push(`Base: ${code(doc.base.sha)} (${doc.base.subject}) on ${doc.base.repo}. No handler is changed by this document.`);
  L.push("");
  L.push("## Result");
  L.push("");
  L.push(`**${bundleStatement(doc)}**`);
  L.push("");
  L.push(doc.bundle_statement_basis);
  L.push("");
  L.push(`${doc.sites.length} site records, ${doc.handlers.length} handler entries, ${doc.ast_baseline.length} AST baseline rows.`);
  L.push("");
  L.push("| Disposition | Records |");
  L.push("|---|---|");
  for (const d of DISPOSITIONS) L.push(`| ${d} | ${counts[d]} |`);
  L.push(`| **Total** | **${doc.sites.length}** |`);
  L.push("");
  const byStatus: Record<string, number> = {};
  for (const s of doc.sites) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  L.push("Status: " + Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
  L.push("");

  L.push("## Method");
  L.push("");
  L.push(doc.regex_commands.note);
  L.push("");
  for (const k of ["a", "b", "c"] as const) {
    L.push(`Regex (${k}):`);
    L.push("");
    L.push("```");
    L.push(doc.regex_commands[k]);
    L.push("```");
    L.push("");
  }
  const rc = doc.regex_counts;
  L.push("| Measure | Count at base |");
  L.push("|---|---|");
  L.push(`| (a) occurrences | ${rc.a_occurrences} |`);
  L.push(`| (a) lines | ${rc.a_lines} |`);
  L.push(`| (a) files | ${rc.a_files} |`);
  L.push(`| (b) lines beyond (a) | ${rc.b_lines_beyond_a} (new since the recon: ${rc.b_new_since_recon.join(", ")}) |`);
  L.push(`| (c) lines | ${rc.c_lines} |`);
  L.push("");
  L.push(`Expected at the base: ${rc.expected}. Differs from expected: ${rc.differs_from_expected ? "yes" : "no"}.`);
  L.push("");
  L.push("Sites are keyed by handler and expression, not by line. `line_at_base` is the first line at the base sha.");
  L.push("");
  L.push("### Disposition vocabulary (D-e)");
  L.push("");
  L.push("| Label | Meaning |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(doc.vocabulary)) L.push(`| ${k} | ${cell(v)} |`);
  L.push("");

  // ESCALATE list
  const esc = doc.sites.filter((s) => s.disposition === "ESCALATE");
  L.push(`## ESCALATE (${esc.length})`);
  L.push("");
  L.push("Each record gives the evidence and a recommendation. The builder picks nothing; ISO reviews every record and VECTOR reviews ESCALATE, ADDRESSED and ATTRIBUTION.");
  L.push("");
  for (const s of esc) {
    L.push(`### ${code(s.id)}`);
    L.push("");
    L.push(`- Where: ${code(s.file)}, handler ${code(s.handler)}, expression ${code(s.expr)}, line ${s.line_at_base || "n/a"} at base, ${s.occurrences} occurrence(s).`);
    L.push(`- Tool: ${s.tool ?? "none"}; transports ${s.transports.join(", ") || "none"}; effect ${s.effect}; decided by ${s.disposition_by}; closes in ${s.closes_in}.`);
    L.push(`- Binding today: ${s.binding_today}.`);
    if (s.name_lists.length) L.push(`- Name lists: ${s.name_lists.join(", ")}.`);
    L.push(`- Evidence: ${s.evidence}`);
    L.push(`- Recommendation: ${s.recommendation ?? "none"}`);
    L.push("");
  }

  // Labels that claim no gate is needed
  for (const d of ["ADDRESSED", "ATTRIBUTION", "NOT-IDENTITY", "SELF-ONLY", "FOREIGN-READ", "FOREIGN-WRITE"] as const) {
    const rows = doc.sites.filter((s) => s.disposition === d);
    if (!rows.length) continue;
    L.push(`## ${d} (${rows.length})`);
    L.push("");
    if (d === "ADDRESSED" || d === "ATTRIBUTION") {
      L.push("Each label claims no gate is needed, so ISO reviews each one individually.");
      L.push("");
    }
    L.push("| Site | Tool | Binding today | Reason |");
    L.push("|---|---|---|---|");
    for (const s of rows) L.push(`| ${cell(s.id)} | ${cell(s.tool ?? "none")} | ${cell(s.binding_today)} | ${cell(s.evidence)} |`);
    L.push("");
  }

  // Invisible classes
  L.push("## Sites the regexes cannot see");
  L.push("");
  L.push("Four classes. Each is a record with `regex: none` and an anchor the test checks in the handler's source.");
  L.push("");
  const classRows: Array<[string, string, (s: SiteRecord) => boolean]> = [
    ["1. REST routes that query Firestore directly (rest.ts:321, 419, 436, 533, 603, 749)", "rest-getfirestore", (s) => s.class === "rest-getfirestore"],
    ["2. Calls that skip callTool (rest.ts:666, 707, 729, 859, and enrollHandler at 975)", "rest-direct-handler", (s) => s.class === "rest-direct-handler"],
    ["3. Object-id handlers named in plan section 6", "object-id", (s) => s.class === "object-id"],
    ["4. Memory fan-out in gsp_search (gsp.ts:1897-1901)", "gsp-memory-scan", (s) => s.class === "gsp-memory-scan"],
  ];
  for (const [title, , pred] of classRows) {
    const rows = doc.sites.filter(pred);
    L.push(`### ${title}`);
    L.push("");
    L.push("| Site | Line at base | Disposition | Binding today |");
    L.push("|---|---|---|---|");
    for (const s of rows) L.push(`| ${cell(s.id)} | ${s.line_at_base || "n/a"} | ${s.disposition} | ${cell(s.binding_today)} |`);
    L.push("");
  }
  const astS2 = doc.ast_baseline.filter((r) => r.rule === "S2" && !r.file.startsWith("modules/"));
  if (astS2.length) {
    L.push("The AST rules also found a tenant-uid comparison outside the tool registry: " + astS2.map((r) => `${code(r.file + ":" + r.line_at_base)} (${r.handler})`).join(", ") + ". It is a baseline row, not a site record.");
    L.push("");
  }

  // All sites by file
  L.push("## All site records");
  L.push("");
  L.push("| Site | Regex | Occ. | Line | Disposition | By | Closes in | Bundle |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const s of doc.sites) {
    L.push(`| ${cell(s.id)} | ${s.regex} | ${s.occurrences} | ${s.line_at_base || "n/a"} | ${s.disposition} | ${cell(s.disposition_by)} | ${cell(s.closes_in)} | ${s.serves_bundle_data} |`);
  }
  L.push("");

  // Handlers
  L.push("## Handler entries (R6)");
  L.push("");
  L.push("| Tool | Handler | Transports | Effect | Sites | Name lists | serves_bundle_data |");
  L.push("|---|---|---|---|---|---|---|");
  for (const h of doc.handlers) {
    L.push(`| ${h.tool}${h.profile === "lite" ? " (lite)" : ""} | ${cell(h.handler)} | ${h.transports.join(" ")} | ${h.effect} | ${h.site_ids.length} | ${h.name_lists.length} | ${h.serves_bundle_data} |`);
  }
  L.push("");
  if (lite.length) L.push(`Lite-profile entries (not in the ${doc.handlers.length - lite.length}): ${lite.map((h) => h.tool).join(", ")}.`);
  L.push("");
  L.push("### Bundle greps");
  L.push("");
  for (const g of doc.bundle_greps) {
    L.push("```");
    L.push(g.cmd);
    for (const o of g.output) L.push(o);
    L.push("```");
    L.push("");
    L.push(`Result: ${g.verdict}.`);
    L.push("");
  }
  const ruled = doc.handlers.filter((h) => h.bundle_ruling);
  L.push(`### Handlers storing caller-keyed tenant data (${ruled.length})`);
  L.push("");
  if (ruled.length) {
    L.push(ruled[0].bundle_basis);
    L.push("");
    L.push("| Tool | Tenant segment built at | Note |");
    L.push("|---|---|---|");
    for (const h of ruled) L.push(`| ${h.tool} | ${cell((h.tenant_partition_cites ?? []).join("; "))} | ${cell(h.bundle_ruling!.note ?? "ruled by ISO, upheld by VECTOR")} |`);
    L.push("");
    L.push("The shared path builder is gspCollectionPath at gsp.ts:66-67, which takes the tenant from its caller. gspListNamespacesHandler builds its own tenant segment at gsp.ts:123-124 (REST direct call, see the invisible-class table).");
    L.push("");
    L.push("Probe T6.gsp_read (src/__tests__/probes/t6.probe.ts) asserts the property at runtime: tenant B reads tenant A's namespace and key and gets found:false, and tenant A reads its own row.");
    L.push("");
    L.push("Namespace and key authority inside the tenant is an authorization question and has its own site records (for example gsp_write source, gsp_search memory scan).");
    L.push("");
  }

  // C-5
  L.push("## C-5 table: hardcoded name lists");
  L.push("");
  L.push("Columns 1 and 2 come from code. Column 3 is filled by ISO from the audit ledger. No list is deleted before VECTOR rules per identity.");
  L.push("");
  L.push("| Name list (file:line, members) | Handlers it guards | Principals that called it in the last 30 days |");
  L.push("|---|---|---|");
  for (const n of doc.name_lists) {
    const members = n.members.length ? n.members.join(", ") : "env-driven";
    L.push(`| ${cell(n.id)} ${code(n.file + ":" + n.line)} [${cell(members)}] (${n.layer}) | ${cell(n.guards.join(", "))} | pending ISO |`);
  }
  L.push("");
  L.push("### Name list notes");
  L.push("");
  for (const n of doc.name_lists) L.push(`- ${n.id}: ${n.note}`);
  L.push("");

  // AST
  L.push("## D-f AST baseline (pending)");
  L.push("");
  const ruleCounts: Record<string, { rows: number; occ: number }> = {};
  for (const r of doc.ast_baseline) {
    const c = (ruleCounts[r.rule] = ruleCounts[r.rule] || { rows: 0, occ: 0 });
    c.rows += 1;
    c.occ += r.occurrences;
  }
  L.push("| Rule | Rows | Occurrences |");
  L.push("|---|---|---|");
  for (const [k, v] of Object.entries(ruleCounts)) L.push(`| ${k} | ${v.rows} | ${v.occ} |`);
  L.push("");
  L.push("The test fails on a violation with no row and on a row that no longer matches. The baseline only shrinks.");
  L.push("");
  L.push("| Rule | File | Handler | Expression | Occ. | Line at base |");
  L.push("|---|---|---|---|---|---|");
  for (const r of doc.ast_baseline) L.push(`| ${r.rule} | ${cell(r.file)} | ${cell(r.handler)} | ${cell(code(r.expr))} | ${r.occurrences} | ${r.line_at_base} |`);
  L.push("");
  return L.join("\n");
}
