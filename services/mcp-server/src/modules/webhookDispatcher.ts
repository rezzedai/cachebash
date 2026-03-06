/**
 * Webhook Dispatcher — GSP webhook subscription notifications.
 * 
 * Sends HTTP POST requests to registered webhook URLs when GSP state changes.
 * Includes HMAC-SHA256 signature verification for webhook security.
 */

import { createHmac } from "crypto";
import { getFirestore } from "../firebase/client.js";

// ── Constants ───────────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 10000; // 10 seconds
const RETRY_DELAYS_MS = [1000, 5000, 15000]; // 1s, 5s, 15s
const MAX_RETRIES = 3;

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebhookEvent {
  event: "state_change";
  namespace: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface WebhookSubscription {
  id: string;
  callbackUrl: string;
  secret?: string; // Stored plaintext for now; encrypt in production
  programId: string;
  namespace: string;
  key: string | null;
}

// ── HMAC Signature Generation ──────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Returns signature in hex format for X-GSP-Signature header.
 * 
 * Format: sha256=<hex_signature>
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

// ── Webhook Dispatch ────────────────────────────────────────────────────────

/**
 * Send HTTP POST to webhook URL with retry logic.
 * 
 * @param subscription - Webhook subscription details
 * @param event - GSP state change event payload
 * @param userId - Tenant ID for dead letter queue
 * @returns Success boolean
 */
export async function dispatchWebhook(
  subscription: WebhookSubscription,
  event: WebhookEvent,
  userId: string
): Promise<boolean> {
  const payload = JSON.stringify(event);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "GSP-Webhook/1.0",
    "X-GSP-Event": event.event,
    "X-GSP-Namespace": event.namespace,
    "X-GSP-Key": event.key,
    "X-GSP-Version": String(event.version),
  };

  // Add HMAC signature if secret is configured
  if (subscription.secret) {
    headers["X-GSP-Signature"] = generateSignature(payload, subscription.secret);
  }

  let lastError: Error | null = null;

  // Attempt delivery with retries
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      const response = await fetch(subscription.callbackUrl, {
        method: "POST",
        headers,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success: 2xx status codes
      if (response.ok) {
        console.log(`[Webhook] Successfully delivered to ${subscription.callbackUrl} (attempt ${attempt + 1})`);
        return true;
      }

      // Non-2xx response
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      console.warn(`[Webhook] Attempt ${attempt + 1} failed: ${lastError.message}`);

      // Don't retry on 4xx client errors (except 408, 429)
      if (response.status >= 400 && response.status < 500 && 
          response.status !== 408 && response.status !== 429) {
        break; // Permanent failure
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Webhook] Attempt ${attempt + 1} failed:`, lastError.message);
    }

    // Wait before retry (unless it's the last attempt)
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  // All retries exhausted - log to dead letter queue
  await logToDeadLetterQueue(userId, subscription, event, lastError);
  return false;
}

// ── Dead Letter Queue ───────────────────────────────────────────────────────

/**
 * Log failed webhook delivery to dead letter queue for manual inspection.
 */
async function logToDeadLetterQueue(
  userId: string,
  subscription: WebhookSubscription,
  event: WebhookEvent,
  error: Error | null
): Promise<void> {
  const db = getFirestore();
  const deadLetterPath = `tenants/${userId}/gsp_dead_letters`;

  try {
    await db.collection(deadLetterPath).add({
      subscriptionId: subscription.id,
      callbackUrl: subscription.callbackUrl,
      programId: subscription.programId,
      event,
      error: error ? {
        message: error.message,
        name: error.name,
        stack: error.stack,
      } : null,
      failedAt: new Date().toISOString(),
      retries: MAX_RETRIES,
    });

    console.log(`[Webhook] Logged failed delivery to dead letter queue for subscription ${subscription.id}`);
  } catch (dlqError) {
    console.error(`[Webhook] Failed to log to dead letter queue:`, dlqError);
  }
}
