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

/**
 * RD-5 PR-N1: one line when a call passes ONLY because the key holds "*" (the literal capability is absent).
 * Log only: the caller's decision is unchanged. A log metric counts `jsonPayload.event = "authz_would_deny"`.
 * Never throws: a logging failure must not turn a passing call into a failing one.
 */
export function logWouldDeny(d: { principal: string; tool: string; capability: string; site: string }): void {
  try {
    console.warn(JSON.stringify({ severity: "WARNING", event: "authz_would_deny", ...d }));
  } catch {
    // swallow: observation only
  }
}
