/**
 * Gate Middleware — Auth + source verification + audit logging.
 *
 * Every request passes through the Gate. The Gate validates the API key,
 * verifies the claimed source identity, and logs the decision.
 */

import { generateCorrelationId } from "./correlationId.js";

export interface AuditEntry {
  timestamp: string;
  correlationId: string;
  tool: string;
  source: string;
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
      details: { tool?: string; durationMs?: number; source?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
        userId,
        endpoint: details.endpoint || "mcp",
        allowed: true,
        durationMs: details.durationMs,
      });
    },
    error(
      action: string,
      reason: string,
      details: { tool?: string; durationMs?: number; source?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
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
 * Verify source claim. Phase 1: basic verification.
 * ISO endpoint requests can claim source "iso".
 * All sources are logged for audit trail.
 */
export function verifySource(
  claimedSource: string | undefined,
  endpoint: "mcp" | "iso" | "rest"
): { valid: boolean; reason?: string } {
  if (!claimedSource) {
    return { valid: true }; // Source not required in Phase 1, but logged
  }

  // ISO endpoint should only claim iso-related sources
  if (endpoint === "iso" && claimedSource !== "iso" && !claimedSource.startsWith("iso")) {
    // Log but allow — Phase 1 is permissive
    console.warn(`[Gate] ISO endpoint claiming non-iso source: ${claimedSource}`);
  }

  return { valid: true };
}

export { generateCorrelationId };
