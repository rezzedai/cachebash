/** Schema of docs/authz-sites.json (RD-5 plan section 6, amendments 1 and 2). */

export const DISPOSITIONS = [
  "SELF-ONLY",
  "FOREIGN-READ",
  "FOREIGN-WRITE",
  "ADDRESSED",
  "ATTRIBUTION",
  "NOT-IDENTITY",
  "ESCALATE",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type SiteClass =
  | "rest-getfirestore"
  | "rest-direct-handler"
  | "object-id"
  | "gsp-memory-scan";

export interface SiteRecord {
  id: string;
  file: string;
  handler: string;
  expr: string;
  /** Regex class that finds the site, or "none" for the sites regex cannot see. */
  regex: "a" | "b" | "c" | "none";
  /** Set when regex is "none". */
  class?: SiteClass;
  /** Text that must appear in the handler's source; checked for regex "none" records. */
  anchor?: string;
  occurrences: number;
  line_at_base: number;
  tool: string | null;
  transports: string[];
  effect: "read" | "write" | "mixed";
  binding_today: string;
  disposition: Disposition;
  disposition_by: string;
  status: "pending" | "done" | "exempt";
  closes_in: string;
  serves_bundle_data: boolean;
  name_lists: string[];
  evidence: string;
  recommendation?: string;
}

export interface HandlerEntry {
  tool: string;
  handler: string;
  file: string;
  domain: string;
  profile: "full" | "lite";
  transports: string[];
  effect: "read" | "write" | "mixed";
  /** True only for an ADR-015 brain bundle (PDR 4.4, R6). */
  serves_bundle_data: boolean;
  /** True when the handler stores or serves a value under a caller-chosen name inside the tenant. */
  stores_caller_keyed_tenant_data: boolean;
  bundle_basis: string;
  /** file:line cites where the tenant path segment is built; each line must read auth.userId only. */
  tenant_partition_cites?: string[];
  bundle_ruling?: { by: string; date: string; message: string; upheld_by: string; note?: string };
  site_ids: string[];
  name_lists: string[];
}

export interface NameList {
  id: string;
  file: string;
  line: number;
  name: string;
  members: string[];
  layer: "handler" | "rest" | "routing" | "middleware" | "auth";
  guard_sites: string[];
  guards: string[];
  note: string;
  usage_30d: string;
}

export interface AstBaselineRow {
  rule: "S1" | "S2" | "S3";
  file: string;
  handler: string;
  expr: string;
  occurrences: number;
  line_at_base: number;
  status: "pending";
}

export interface BundleGrep {
  cmd: string;
  output: string[];
  verdict: string;
}

export interface AuthzSites {
  schema_version: number;
  generated_by: string;
  base: { repo: string; sha: string; short: string; subject: string };
  regex_commands: { note: string; a: string; b: string; c: string };
  regex_counts: {
    a_occurrences: number;
    a_lines: number;
    a_files: number;
    b_lines_beyond_a: number;
    b_new_since_recon: string[];
    c_lines: number;
    expected: string;
    differs_from_expected: boolean;
  };
  vocabulary: Record<string, string>;
  bundle_greps: BundleGrep[];
  bundle_statement_basis: string;
  name_lists: NameList[];
  c5_usage_source: { file: string; repo: string; merged: string; measured: string; caveat: string };
  handlers: HandlerEntry[];
  sites: SiteRecord[];
  ast_baseline: AstBaselineRow[];
}
