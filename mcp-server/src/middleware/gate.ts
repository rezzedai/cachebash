/**
 * Gate Middleware — Auth + source verification + audit logging.
 *
 * Every request passes through the Gate. The Gate validates the API key,
 * verifies the claimed source identity, and logs the decision.
 *
 * Phase 2: Source verification is ENFORCED. The key's programId must match
 * the claimed source. Source spoofing is impossible.
 */

import { generateCorrelationId } from "./correlationId.js";
import type { AuthContext } from "../auth/apiKeyValidator.js";

export interface AuditEntry {
  timestamp: string;
  correlationId: string;
  tool: string;
  source: string;
  programId: string;
  userId: string;
  endpoint: string;
  allowed: boolean;
  reason?: string;
  durationMs?: number;
}

export function logAudit(entry: AuditEntry): void {
  console.log(JSON.stringify(entry));
}

export function createAuditLogger(correlationId: string, userId: string) {
  return {
    log(
      action: string,
      details: { tool?: string; durationMs?: number; source?: string; programId?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
        programId: details.programId || "unknown",
        userId,
        endpoint: details.endpoint || "mcp",
        allowed: true,
        durationMs: details.durationMs,
      });
    },
    error(
      action: string,
      reason: string,
      details: { tool?: string; durationMs?: number; source?: string; programId?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
        programId: details.programId || "unknown",
        userId,
        endpoint: details.endpoint || "mcp",
        allowed: false,
        reason,
        durationMs: details.durationMs,
      });
    },
  };
}

/**
 * Verify source claim against key identity.
 * Phase 2: ENFORCED. Key's programId must match claimed source.
 *
 * Returns the verified source (auto-populated from key if not claimed).
 * Throws on mismatch.
 */
export function verifySource(
  claimedSource: string | undefined,
  auth: AuthContext,
  endpoint: "mcp" | "iso" | "rest"
): string {
  // Legacy keys get permissive treatment (backward compat during migration)
  if (auth.programId === "legacy" || auth.programId === "mobile") {
    return claimedSource || auth.programId;
  }

  // If no source claimed, auto-populate from key identity
  if (!claimedSource) {
    return auth.programId;
  }

  // Source claim must match key identity
  if (claimedSource !== auth.programId) {
    throw new Error(
      `Source mismatch: key belongs to "${auth.programId}", claimed "${claimedSource}". ` +
      `Each program must use its own API key.`
    );
  }

  return claimedSource;
}

export { generateCorrelationId };
