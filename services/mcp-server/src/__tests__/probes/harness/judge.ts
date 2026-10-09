import type { ToolResult } from "./client";

/** A call was refused: transport error, tool error, success:false, or a denial string. */
export function denied(r: ToolResult): boolean {
  if (r.httpStatus >= 400 || r.isError) return true;
  if (r.json && r.json.success === false) return true;
  return /access denied|permission denied|forbidden|not authorized|unauthorized|not found/i.test(r.text);
}

/** The result carries rows tagged with `mk`. */
export const sees = (r: ToolResult, mk: string): boolean => !denied(r) && r.text.includes(mk);

/**
 * N (A-11): a denial must contain the true principal in quotes, as `"alpha"`.
 * Returns true when the denial is present AND names the principal.
 */
export function denialNames(r: ToolResult, principal: string): boolean {
  return denied(r) && r.text.includes(`"${principal}"`);
}
