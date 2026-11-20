/**
 * RD-5 PR-C: D-f static rules S1 to S3 over non-test src/.
 *
 * S1  any read of `.programId` on a value of type AuthContext, outside auth/
 * S2  `auth.userId` (a value of type AuthContext, property userId) as an operand of
 *     ===, !==, ==, != or as an argument to `.includes()`
 * S3  an identifier-argument expression (regex A receivers and names) as an operand of an
 *     equality operator, or as an argument or receiver of `.includes()`, against a
 *     non-literal, outside auth/authorize.ts. "Non-literal" means the other operand is not a
 *     string, number, null, undefined, boolean or array-of-literals expression.
 *
 * S1 and S2 need types, so the checker builds a ts.Program. S3 is syntactic.
 */
import * as path from "path";
import * as ts from "typescript";
import { listSourceFiles, ownerAt } from "./scan";

export type RuleId = "S1" | "S2" | "S3";

export interface Violation {
  rule: RuleId;
  file: string;
  line: number;
  handler: string;
  /** Source text of the offending expression. */
  expr: string;
}

const EQ_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

const A_RECEIVERS = new Set(["args", "query", "body"]);
const A_PROPS = new Set(["agentId", "target", "targetProgram", "sessionId", "programId", "source"]);

function isIdentifierArgument(n: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(n)) return false;
  if (!A_PROPS.has(n.name.text)) return false;
  const recv = n.expression;
  if (ts.isIdentifier(recv)) return A_RECEIVERS.has(recv.text);
  if (ts.isPropertyAccessExpression(recv) && ts.isIdentifier(recv.expression) && recv.expression.text === "req") {
    return ["params", "query", "body"].includes(recv.name.text);
  }
  return false;
}

function isLiteralish(n: ts.Node): boolean {
  if (ts.isParenthesizedExpression(n)) return isLiteralish(n.expression);
  if (ts.isAsExpression(n) || ts.isNonNullExpression(n)) return isLiteralish(n.expression);
  if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return true;
  if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(n) && n.text === "undefined") return true;
  if (ts.isArrayLiteralExpression(n)) return n.elements.every(isLiteralish);
  return false;
}

function isAuthContextType(checker: ts.TypeChecker, expr: ts.Expression): boolean {
  const t = checker.getTypeAtLocation(expr);
  const syms = [t.getSymbol(), t.aliasSymbol, ...(t.isUnion() ? t.types.map((x) => x.getSymbol()) : [])];
  return syms.some((s) => s?.getName() === "AuthContext");
}

function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

/**
 * Check source files. `files` are absolute paths; `rel` maps an absolute path to the name
 * recorded in the baseline.
 */
export function checkProgram(
  program: ts.Program,
  files: string[],
  rel: (abs: string) => string
): Violation[] {
  const checker = program.getTypeChecker();
  const out: Violation[] = [];
  for (const abs of files) {
    const sf = program.getSourceFile(abs);
    if (!sf) throw new Error(`authz rules: source file not in program: ${abs}`);
    const file = rel(abs);
    const inAuthDir = file.startsWith("auth/");
    const isAuthorize = file === "auth/authorize.ts";
    const push = (rule: RuleId, node: ts.Node): void => {
      out.push({ rule, file, line: lineOf(sf, node), handler: ownerAt(sf, node.getStart(sf)), expr: node.getText(sf) });
    };

    const visit = (node: ts.Node): void => {
      // S1 / S2: property reads on AuthContext
      if (ts.isPropertyAccessExpression(node) && isAuthContextType(checker, node.expression)) {
        if (node.name.text === "programId" && !inAuthDir) push("S1", node);
        if (node.name.text === "userId") {
          const parent = node.parent;
          const inEq = ts.isBinaryExpression(parent) && EQ_OPS.has(parent.operatorToken.kind);
          const inIncludes =
            ts.isCallExpression(parent) &&
            ts.isPropertyAccessExpression(parent.expression) &&
            parent.expression.name.text === "includes" &&
            parent.arguments.includes(node as ts.Expression);
          if (inEq || inIncludes) push("S2", node);
        }
      }
      // S3: identifier-argument expressions in comparisons
      if (!isAuthorize) {
        if (ts.isBinaryExpression(node) && EQ_OPS.has(node.operatorToken.kind)) {
          for (const [self, other] of [
            [node.left, node.right],
            [node.right, node.left],
          ] as const) {
            if (isIdentifierArgument(self) && !isLiteralish(other)) {
              push("S3", self);
              break;
            }
          }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "includes") {
          const recv = node.expression.expression;
          const arg = node.arguments[0];
          if (arg && isIdentifierArgument(arg) && !isLiteralish(recv)) push("S3", arg);
          if (isIdentifierArgument(recv) && arg && !isLiteralish(arg)) push("S3", recv);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** Build a program over the non-test sources of srcRoot using the repo's compiler options. */
export function buildSrcProgram(srcRoot: string, extraFiles: string[] = []): { program: ts.Program; files: string[] } {
  const files = listSourceFiles(srcRoot).map((f) => path.join(srcRoot, f));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    lib: ["lib.es2022.d.ts"],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    types: ["node"],
  };
  const program = ts.createProgram([...files, ...extraFiles], options);
  return { program, files };
}

export interface BaselineRow {
  rule: RuleId;
  file: string;
  handler: string;
  expr: string;
  occurrences: number;
  line_at_base: number;
  status: "pending";
}

export function groupViolations(vs: Violation[]): BaselineRow[] {
  const map = new Map<string, BaselineRow>();
  for (const v of vs) {
    const key = [v.rule, v.file, v.handler, v.expr].join("\u0000");
    const r = map.get(key);
    if (r) {
      r.occurrences += 1;
      r.line_at_base = Math.min(r.line_at_base, v.line);
    } else {
      map.set(key, { rule: v.rule, file: v.file, handler: v.handler, expr: v.expr, occurrences: 1, line_at_base: v.line, status: "pending" });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.rule === b.rule ? (a.file === b.file ? a.line_at_base - b.line_at_base : a.file.localeCompare(b.file)) : a.rule.localeCompare(b.rule)
  );
}
