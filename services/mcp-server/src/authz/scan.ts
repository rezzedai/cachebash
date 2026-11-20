/**
 * RD-5 PR-C: authorization call-site scanner.
 *
 * The three regexes are the same patterns recorded as `git grep -P` commands in
 * docs/authz-sites.json. JavaScript and PCRE agree on these patterns (\b, groups,
 * alternation). Each hit is attributed to its enclosing handler by the TypeScript
 * AST: a top-level function, an arrow function bound to a variable, or a
 * `route("METHOD", "/path", ...)` call.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export const REGEX_A =
  /\b(args|query|body|req\.(params|query|body))\.(agentId|target|targetProgram|sessionId|programId|source)\b/g;

export const REGEX_B =
  /\b(args|query|body|p|params|input|parsed|validated)\.(agent|agentId|program|programId|program_id|target|targetProgram|target_program|sessionId|session_id|source|callerSource|from|to|recipient|owner|ownerId|assignee|claimedBy|seatId|tenantId|userId|uid|principal|newTarget|reassignTo|escalateTo|keyHash)\b/g;

export const REGEX_C =
  /const \{[^}]*\b(agentId|target|targetProgram|sessionId|programId|source|keyHash|userId|callerSource)\b[^}]*\} = (args|req|body|query|input|parsed|params|p)\b/g;

export type RegexClass = "a" | "b" | "c";

export interface Hit {
  regex: RegexClass;
  /** Path relative to src/, forward slashes. */
  file: string;
  line: number;
  /** Matched text for a and b; for c, the destructured name(s) joined by comma. */
  expr: string;
  /** Enclosing handler, as `ownerOf` names it. */
  handler: string;
}

export interface Group {
  file: string;
  handler: string;
  expr: string;
  regex: RegexClass;
  occurrences: number;
  line_at_base: number;
}

/** All non-test .ts files under srcRoot, relative to it, sorted. */
export function listSourceFiles(srcRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "__tests__" || ent.name === "node_modules") continue;
        walk(full);
      } else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
        out.push(path.relative(srcRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(srcRoot);
  return out.sort();
}

export function parseFile(srcRoot: string, file: string): ts.SourceFile {
  const text = fs.readFileSync(path.join(srcRoot, file), "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
}

function literalText(n: ts.Node | undefined): string {
  if (!n) return "?";
  if (ts.isStringLiteralLike(n)) return n.text;
  return n.getText();
}

/**
 * Name of the handler that encloses `pos`: innermost function declaration, or
 * variable bound to an arrow/function expression, or `route` call. A `route`
 * call wins over the arrow function inside it. Module-level code is "(module)".
 */
export function ownerAt(sf: ts.SourceFile, pos: number): string {
  let owner = "(module)";
  let routeOwner: string | null = null;
  const walk = (node: ts.Node): void => {
    if (pos < node.getStart(sf) || pos >= node.end) return;
    if (ts.isFunctionDeclaration(node) && node.name) {
      owner = node.name.text;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      owner = node.name.text;
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "route") {
      routeOwner = `route ${literalText(node.arguments[0])} ${literalText(node.arguments[1])}`;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return routeOwner ?? owner;
}

/** All owners (handlers and routes) defined in a file, for existence checks. */
export function listOwners(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      out.set(node.name.text, node);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "route") {
      out.set(`route ${literalText(node.arguments[0])} ${literalText(node.arguments[1])}`, node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

function matchAll(re: RegExp, line: string): RegExpExecArray[] {
  const r = new RegExp(re.source, "g");
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(line))) out.push(m);
  return out;
}

/** Scan one file. Class b keeps only lines that class a does not match. */
export function scanFile(srcRoot: string, file: string): Hit[] {
  const sf = parseFile(srcRoot, file);
  const lines = sf.text.split("\n");
  const hits: Hit[] = [];
  lines.forEach((line, i) => {
    const pos = (col: number): number => sf.getPositionOfLineAndCharacter(i, col);
    const a = matchAll(REGEX_A, line);
    for (const m of a) hits.push({ regex: "a", file, line: i + 1, expr: m[0], handler: ownerAt(sf, pos(m.index)) });
    if (a.length === 0) {
      for (const m of matchAll(REGEX_B, line)) {
        hits.push({ regex: "b", file, line: i + 1, expr: m[0], handler: ownerAt(sf, pos(m.index)) });
      }
    }
    for (const m of matchAll(REGEX_C, line)) {
      hits.push({ regex: "c", file, line: i + 1, expr: destructuredNames(m[0]), handler: ownerAt(sf, pos(m.index)) });
    }
  });
  return hits;
}

function destructuredNames(text: string): string {
  const inner = text.slice(text.indexOf("{") + 1, text.indexOf("}"));
  return inner
    .split(",")
    .map((s) => s.trim().split(/[\s=:]/)[0])
    .filter((s) => /^(agentId|target|targetProgram|sessionId|programId|source|keyHash|userId|callerSource)$/.test(s))
    .join(",");
}

export function scanSrc(srcRoot: string): Hit[] {
  const out: Hit[] = [];
  for (const f of listSourceFiles(srcRoot)) out.push(...scanFile(srcRoot, f));
  return out;
}

/** Group hits by (file, handler, expr, regex class). */
export function groupHits(hits: Hit[]): Group[] {
  const map = new Map<string, Group>();
  for (const h of hits) {
    const key = [h.file, h.handler, h.expr, h.regex].join("\u0000");
    const g = map.get(key);
    if (g) {
      g.occurrences += 1;
      g.line_at_base = Math.min(g.line_at_base, h.line);
    } else {
      map.set(key, { file: h.file, handler: h.handler, expr: h.expr, regex: h.regex, occurrences: 1, line_at_base: h.line });
    }
  }
  return [...map.values()].sort((x, y) =>
    x.file === y.file ? x.line_at_base - y.line_at_base || x.expr.localeCompare(y.expr) : x.file.localeCompare(y.file)
  );
}

export function siteKey(file: string, handler: string, expr: string): string {
  return `${file}|${handler}|${expr}`;
}
