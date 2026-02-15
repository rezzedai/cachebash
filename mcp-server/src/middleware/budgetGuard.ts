/**
 * Budget Guard — Dream Mode budget enforcement.
 * Kill Mechanism 1: Gate-level check before tool execution.
 *
 * Queries active dreams for the calling program and rejects
 * tool calls when budget_consumed_usd >= budget_cap_usd.
 *
 * Uses a 60-second TTL cache to avoid per-call Firestore reads.
 */

import { getFirestore } from "../firebase/client.js";
import type { AuthContext } from "../auth/apiKeyValidator.js";

interface BudgetCheckResult {
  allowed: boolean;
  dreamId?: string;
  reason?: string;
}

interface CacheEntry extends BudgetCheckResult {
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function checkDreamBudget(auth: AuthContext): Promise<BudgetCheckResult> {
  const cacheKey = `${auth.userId}:${auth.programId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { allowed: cached.allowed, dreamId: cached.dreamId, reason: cached.reason };
  }

  try {
    const db = getFirestore();
    // Uses existing type+status composite index
    const snapshot = await db
      .collection(`users/${auth.userId}/tasks`)
      .where("type", "==", "dream")
      .where("status", "==", "active")
      .limit(5)
      .get();

    if (snapshot.empty) {
      const result: BudgetCheckResult = { allowed: true };
      cache.set(cacheKey, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

    // Client-side filter for this program's dream
    const dreamDoc = snapshot.docs.find(d => d.data().dream?.agent === auth.programId);
    if (!dreamDoc) {
      const result: BudgetCheckResult = { allowed: true };
      cache.set(cacheKey, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

    const dream = dreamDoc.data().dream;
    const consumed = dream?.budget_consumed_usd || 0;
    const cap = dream?.budget_cap_usd || 0;

    if (cap > 0 && consumed >= cap) {
      const result: BudgetCheckResult = {
        allowed: false,
        dreamId: dreamDoc.id,
        reason: `Dream budget exceeded: $${consumed.toFixed(4)} >= $${cap.toFixed(2)} cap`,
      };
      cache.set(cacheKey, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

    const result: BudgetCheckResult = { allowed: true, dreamId: dreamDoc.id };
    cache.set(cacheKey, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    // On error, allow the call but log — fail-open for availability
    console.error("[BudgetGuard] Check failed:", err);
    return { allowed: true };
  }
}

/** Invalidate cache for a user/program (call after dream activation/deactivation) */
export function invalidateBudgetCache(userId: string, programId: string): void {
  cache.delete(`${userId}:${programId}`);
}
