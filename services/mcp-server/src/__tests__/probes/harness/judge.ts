import type { ToolResult } from "./client";

/** A call was refused: transport error, tool error, success:false, or a denial string. */
export function denied(r: ToolResult): boolean {
  if (r.httpStatus >= 400 || r.isError) return true;
  if (r.json && r.json.success === false) return true;
  return /access denied|permission denied|forbidden|not authorized|unauthorized|not found/i.test(r.text);
}

/** The result carries rows tagged with `mk`. */
export const sees = (r: ToolResult, mk: string): boolean => !denied(r) && r.text.includes(mk);

/** The human-readable denial, decoded: the JSON `error` / `message` fields, else the raw text. */
export function denialText(r: ToolResult): string {
  const parts = [r.json?.error, r.json?.message].filter((v) => typeof v === "string");
  return parts.length ? parts.join(" ") : r.text;
}

/**
 * N (A-11): a denial must contain the true principal in quotes, as "alpha".
 * True only when the call WAS denied (loudly) and the text names the principal.
 */
export function denialNames(r: ToolResult, principal: string): boolean {
  return denied(r) && denialText(r).includes(`"${principal}"`);
}
