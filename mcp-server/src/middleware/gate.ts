/**
 * Gate Middleware — Auth + source verification + audit logging.
 *
 * Every request passes through the Gate. The Gate validates the API key,
 * verifies the claimed source identity, and logs the decision.
 *
 * Phase 2: Source verification is ENFORCED. Audit entries persisted to Firestore.
 */

import { generateCorrelationId } from "./correlationId.js";
import { getFirestore, serverTimestamp } from "../firebase/client.js";
import type { AuthContext } from "../auth/apiKeyValidator.js";

export interface AuditEntry {
  timestamp: string;
  correlationId: string;
  tool: string;
  source: string;
  claimedSource?: string;
  programId: string;
  userId: string;
  endpoint: string;
  allowed: boolean;
  reason?: string;
  durationMs?: number;
}

/** Log audit entry to console AND persist to Firestore */
export function logAudit(entry: AuditEntry): void {
  // Always log to console for Cloud Run visibility
  console.log(JSON.stringify(entry));

  // Persist to Firestore (fire-and-forget)
  if (entry.userId) {
    const db = getFirestore();
    db.collection(`users/${entry.userId}/audit`).add({
      ...entry,
      timestamp: serverTimestamp(),
    }).catch((err) => {
      console.error("[Audit] Failed to persist audit entry:", err);
    });
  }
}

export function createAuditLogger(correlationId: string, userId: string) {
  return {
    log(
      action: string,
      details: { tool?: string; durationMs?: number; source?: string; claimedSource?: string; programId?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
        claimedSource: details.claimedSource,
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
      details: { tool?: string; durationMs?: number; source?: string; claimedSource?: string; programId?: string; endpoint?: string } = {}
    ) {
      logAudit({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: details.tool || action,
        source: details.source || "unknown",
        claimedSource: details.claimedSource,
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
 */
export function verifySource(
  claimedSource: string | undefined,
  auth: AuthContext,
  endpoint: "mcp" | "iso" | "rest"
): string {
  if (auth.programId === "legacy" || auth.programId === "mobile") {
    return claimedSource || auth.programId;
  }

  if (!claimedSource) {
    return auth.programId;
  }

  if (claimedSource !== auth.programId) {
    throw new Error(
      `Source mismatch: key belongs to "${auth.programId}", claimed "${claimedSource}". ` +
      `Each program must use its own API key.`
    );
  }

  return claimedSource;
}

export { generateCorrelationId };
