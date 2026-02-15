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

/**
 * Check dream budget and kill switch for a tool call.
 * Returns null if OK, or an error message if blocked.
 */
export async function checkDreamBudget(
  userId: string,
  sessionId: string | undefined,
  toolName: string,
): Promise<string | null> {
  if (!sessionId) return null;

  const db = getFirestore();

  // Find the session to check if it's linked to a dream
  const sessionDoc = await db.doc(`users/${userId}/sessions/${sessionId}`).get();
  if (!sessionDoc.exists) return null;

  const sessionData = sessionDoc.data()!;
  const dreamId = sessionData.dreamId;
  if (!dreamId) return null;

  // Get the dream task
  const dreamDoc = await db.doc(`users/${userId}/tasks/${dreamId}`).get();
  if (!dreamDoc.exists) return null;

  const dream = dreamDoc.data()!;

  // Kill switch: if dream was killed (status == "failed"), reject immediately
  if (dream.status === "failed" || dream.status === "derezzed") {
    return `DREAM_KILLED: Dream session has been terminated. Reason: ${dream.dream?.killReason || "Killed by user"}`;
  }

  // Budget check
  const budgetCap = dream.dream?.budget_cap_usd;
  if (budgetCap && budgetCap > 0) {
    const budgetConsumed = dream.dream?.budget_consumed_usd || 0;
    if (budgetConsumed >= budgetCap) {
      return `BUDGET_EXCEEDED: Dream budget exhausted. Consumed: $${budgetConsumed.toFixed(4)}, Cap: $${budgetCap.toFixed(2)}`;
    }
  }

  return null;
}

export { generateCorrelationId };
