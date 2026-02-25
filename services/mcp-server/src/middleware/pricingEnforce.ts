/**
 * Pricing Enforcement Middleware — Enforces tier limits on write operations.
 *
 * Checks write operations against billing tier limits (free, pro, team).
 * Reads billing config from Firestore with 30s cache TTL.
 * Fails open on errors to avoid blocking legitimate requests.
 */

import type { AuthContext } from "../auth/authValidator.js";
import { getFirestore } from "../firebase/client.js";
import type { BillingConfig } from "../types/billing.js";
import { DEFAULT_BILLING_CONFIG, PRO_BILLING_CONFIG, TEAM_BILLING_CONFIG } from "../types/billing.js";
import { getUsage } from "./usage.js";

export type PricingResult =
  | { allowed: true; warning?: string }
  | { allowed: false; reason: string };

const WRITE_OPERATIONS = new Set([
  "create_task",
  "send_message",
  "create_session",
  "create_sprint",
  "create_key",
]);

const CACHE_TTL_MS = 30_000;
const billingCache = new Map<string, { config: BillingConfig; expires: number }>();

async function getBillingConfig(userId: string): Promise<BillingConfig> {
  const now = Date.now();
  const cached = billingCache.get(userId);
  if (cached && cached.expires > now) return cached.config;

  try {
    const db = getFirestore();
    const doc = await db.doc(`tenants/${userId}/config/billing`).get();
    const data = doc.data();
    const tier = data?.tier || "free";

    let config: BillingConfig;
    if (tier === "team") {
      config = TEAM_BILLING_CONFIG;
    } else if (tier === "pro") {
      config = PRO_BILLING_CONFIG;
    } else {
      config = DEFAULT_BILLING_CONFIG;
    }

    billingCache.set(userId, { config, expires: now + CACHE_TTL_MS });
    return config;
  } catch (err) {
    console.error("[Pricing] Failed to load billing config:", err);
    return DEFAULT_BILLING_CONFIG;
  }
}

/**
 * Count active (non-done, non-archived) sessions for a user.
 * Used to enforce concurrentSessions billing limit.
 */
async function countActiveSessions(userId: string): Promise<number> {
  const db = getFirestore();
  const snap = await db.collection(`tenants/${userId}/sessions`)
    .where("archived", "==", false)
    .where("status", "in", ["active", "blocked"])
    .count()
    .get();
  return snap.data().count;
}

export async function checkPricing(auth: AuthContext, toolName: string): Promise<PricingResult> {
  try {
    // Only check write operations
    if (!WRITE_OPERATIONS.has(toolName)) {
      return { allowed: true };
    }

    const config = await getBillingConfig(auth.userId);

    // Session concurrency check for create_session
    if (toolName === "create_session" && config.limits.concurrentSessions !== Infinity) {
      const activeCount = await countActiveSessions(auth.userId);
      if (activeCount >= config.limits.concurrentSessions) {
        if (config.softWarnOnly) {
          return { allowed: true, warning: `Over session limit (${activeCount}/${config.limits.concurrentSessions})` };
        }
        return {
          allowed: false,
          reason: `Concurrent session limit reached (${activeCount}/${config.limits.concurrentSessions}). Upgrade to Pro for more sessions.`,
        };
      }
    }

    const usage = await getUsage(auth.userId);

    // Check tasks_created against tasksPerMonth limit
    const usageRatio = config.limits.tasksPerMonth === Infinity
      ? 0
      : usage.tasks_created / config.limits.tasksPerMonth;

    if (usageRatio >= 1.0) {
      if (config.softWarnOnly) {
        return { allowed: true, warning: "Over soft limit — usage exceeds plan allocation" };
      }
      return { allowed: false, reason: "Monthly limit reached. Upgrade to Pro for unlimited access." };
    }

    if (usageRatio >= 0.95) {
      return { allowed: true, warning: "Near limit (95%) — consider upgrading" };
    }

    if (usageRatio >= 0.80) {
      return { allowed: true, warning: "Approaching limit (80%)" };
    }

    return { allowed: true };
  } catch (err) {
    // Fail-open: if pricing check throws, allow the operation
    console.error("[Pricing] Check failed, failing open:", err);
    return { allowed: true };
  }
}
