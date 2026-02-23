/**
 * Gate Middleware — Auth + source verification + audit logging.
 *
 * Every request passes through the Gate. The Gate validates the API key,
 * verifies the claimed source identity, and logs the decision.
 *
 * Phase 2: Source verification is ENFORCED. Audit entries persisted to ledger collection.
 */

import { generateCorrelationId } from "./correlationId.js";
import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { emitEvent } from "../modules/events.js";
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

/**
 * Classify Guardian rejection reason into structured categories.
 */
function classifyGuardianReason(entry: AuditEntry): string {
  if (!entry.allowed) {
    const reason = (entry.reason || "").toLowerCase();
    if (reason.includes("mismatch") || reason.includes("source")) return "SOURCE_MISMATCH";
    if (reason.includes("rate") || reason.includes("limit")) return "RATE_LIMIT";
    if (reason.includes("credential") || reason.includes("key") || reason.includes("auth")) return "CREDENTIAL";
    if (reason.includes("budget") || reason.includes("cost")) return "BUDGET";
    if (reason.includes("capability") || reason.includes("permission") || reason.includes("insufficient")) return "INSUFFICIENT_CAPABILITY";
    if (reason.includes("destroy") || reason.includes("delete") || reason.includes("force")) return "DESTRUCTIVE_OP";
    return "UNKNOWN";
  }
  return "NONE";
}

/** Log audit entry to console AND persist to Firestore */
export function logAudit(entry: AuditEntry): void {
  // Always log to console for Cloud Run visibility
  console.log(JSON.stringify(entry));

  // Persist to Firestore (fire-and-forget)
  // Filter undefined values — Firestore rejects them
  if (entry.userId) {
    const db = getFirestore();
    const clean = Object.fromEntries(
      Object.entries(entry).filter(([_, v]) => v !== undefined)
    );
    db.collection(`users/${entry.userId}/ledger`).add({
      ...clean,
      type: "audit",
      timestamp: serverTimestamp(),
    }).catch((err) => {
      console.error("[Audit] Failed to persist audit entry:", err);
    });

    // Emit telemetry event
    emitEvent(entry.userId, {
      event_type: "GUARDIAN_CHECK",
      program_id: entry.programId,
      session_id: entry.correlationId,
      tool: entry.tool,
      decision: entry.allowed ? "ALLOW" : "BLOCK",
      reason_class: classifyGuardianReason(entry),
      source: entry.source,
      claimed_source: entry.claimedSource,
      endpoint: entry.endpoint,
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
  endpoint: "mcp" | "admin" | "rest"
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
