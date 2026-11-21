import type { AuthContext } from "./authValidator.js";

export type DenialCode = "FOREIGN_SUBJECT" | "NOT_OWNER" | "NOT_GRANTED" | "SOURCE_MISMATCH" | "MISSING_CAPABILITY";

/** One line per refusal. Cloud Logging reads `severity`; a log metric counts `jsonPayload.event = "authz_denial"`. */
export function logDenial(d: { principal: string; tool: string; subject: string | null; code: DenialCode }): void {
  console.warn(JSON.stringify({ severity: "WARNING", event: "authz_denial", ...d }));
}

/** The principal for a denial line. Never throws: an empty credential identity logs as "(none)". */
export function denialPrincipal(auth: Pick<AuthContext, "keyProgramId">): string {
  return auth.keyProgramId || "(none)";
}
