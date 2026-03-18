/**
 * Webhook Module — Task lifecycle webhook registration, filtering, and dispatch.
 */

import { createHash } from "crypto";
import { z } from "zod";
import type { AuthContext } from "../auth/authValidator.js";
import { getFirestore } from "../firebase/client.js";
import { dispatchWebhook, type WebhookSubscription, type WebhookEvent } from "./webhookDispatcher.js";
import { jsonResult } from "./dispatch/shared.js";

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_EVENTS = [
  "task.created",
  "task.claimed",
  "task.completed",
  "task.failed",
  "task.retried",
  "task.aborted",
] as const;

type TaskEventType = (typeof VALID_EVENTS)[number];

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskWebhookEvent {
  event: TaskEventType;
  taskId: string;
  task: Record<string, unknown>;
  timestamp: string;
  tenantId: string;
}

interface WebhookRegistration {
  id: string;
  events: string[];
  callbackUrl: string;
  secret: string | null;
  secretHash: string | null;
  filter: {
    target?: string;
    source?: string;
    projectId?: string;
  } | null;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
}

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  events: z.array(z.enum(VALID_EVENTS)).min(1),
  callbackUrl: z.string().max(500).refine((url) => url.startsWith("https://"), {
    message: "callbackUrl must use HTTPS",
  }),
  secret: z.string().max(200).optional(),
  filter: z.object({
    target: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
    projectId: z.string().max(100).optional(),
  }).optional(),
});

const listSchema = z.object({
  enabled: z.boolean().optional(),
  limit: z.number().min(1).max(50).default(20),
});

const deleteSchema = z.object({
  webhookId: z.string(),
});

const getDeliveriesSchema = z.object({
  webhookId: z.string().optional(),
  status: z.enum(["success", "failed"]).optional(),
  limit: z.number().min(1).max(100).default(20),
});

// ── Utility Functions ───────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Check if a task matches a webhook's filter criteria.
 * All specified filter fields must match (AND logic).
 */
function matchesFilter(
  task: Record<string, unknown>,
  filter: WebhookRegistration["filter"]
): boolean {
  if (!filter) return true; // No filter = match all

  if (filter.target && task.target !== filter.target) {
    return false;
  }
  if (filter.source && task.source !== filter.source) {
    return false;
  }
  if (filter.projectId && task.projectId !== filter.projectId) {
    return false;
  }

  return true;
}

// ── Handler Functions ───────────────────────────────────────────────────────

/**
 * Register a new webhook subscription for task events.
 */
export async function webhookRegisterHandler(
  auth: AuthContext,
  args: unknown
): Promise<ReturnType<typeof jsonResult>> {
  const parsed = registerSchema.parse(args);
  const db = getFirestore();

  const webhookData: Omit<WebhookRegistration, "id"> = {
    events: parsed.events,
    callbackUrl: parsed.callbackUrl,
    secret: parsed.secret || null,
    secretHash: parsed.secret ? sha256(parsed.secret) : null,
    filter: parsed.filter || null,
    enabled: true,
    createdAt: new Date().toISOString(),
    createdBy: auth.programId,
  };

  const ref = await db.collection(`tenants/${auth.userId}/webhooks`).add(webhookData);

  return jsonResult({
    success: true,
    webhookId: ref.id,
    events: parsed.events,
    callbackUrl: parsed.callbackUrl,
    hasSecret: !!parsed.secret,
  });
}

/**
 * List webhook registrations (never expose raw secrets).
 */
export async function webhookListHandler(
  auth: AuthContext,
  args: unknown
): Promise<ReturnType<typeof jsonResult>> {
  const parsed = listSchema.parse(args);
  const db = getFirestore();

  let query = db.collection(`tenants/${auth.userId}/webhooks`)
    .orderBy("createdAt", "desc")
    .limit(parsed.limit);

  if (parsed.enabled !== undefined) {
    query = query.where("enabled", "==", parsed.enabled) as any;
  }

  const snapshot = await query.get();

  const webhooks = snapshot.docs.map((doc) => {
    const data = doc.data() as WebhookRegistration;
    return {
      id: doc.id,
      events: data.events,
      callbackUrl: data.callbackUrl,
      hasSecret: !!data.secret,
      filter: data.filter,
      enabled: data.enabled,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
    };
  });

  return jsonResult({
    success: true,
    webhooks,
    count: webhooks.length,
  });
}

/**
 * Delete a webhook registration.
 */
export async function webhookDeleteHandler(
  auth: AuthContext,
  args: unknown
): Promise<ReturnType<typeof jsonResult>> {
  const parsed = deleteSchema.parse(args);
  const db = getFirestore();

  const docRef = db.doc(`tenants/${auth.userId}/webhooks/${parsed.webhookId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResult({
      success: false,
      error: "Webhook not found",
    });
  }

  await docRef.delete();

  return jsonResult({
    success: true,
    webhookId: parsed.webhookId,
    message: "Webhook deleted",
  });
}

/**
 * Get webhook delivery logs.
 */
export async function webhookGetDeliveriesHandler(
  auth: AuthContext,
  args: unknown
): Promise<ReturnType<typeof jsonResult>> {
  const parsed = getDeliveriesSchema.parse(args);
  const db = getFirestore();

  let query = db.collection(`tenants/${auth.userId}/webhook_deliveries`)
    .orderBy("timestamp", "desc")
    .limit(parsed.limit);

  if (parsed.webhookId) {
    query = query.where("webhookId", "==", parsed.webhookId) as any;
  }
  if (parsed.status) {
    query = query.where("status", "==", parsed.status) as any;
  }

  const snapshot = await query.get();

  const deliveries = snapshot.docs.map((doc) => doc.data());

  return jsonResult({
    success: true,
    deliveries,
    count: deliveries.length,
  });
}

// ── Task Event Dispatch ─────────────────────────────────────────────────────

/**
 * Fire-and-forget: dispatch webhook notifications for a task lifecycle event.
 * Queries registered webhooks, applies filter matching, and dispatches via webhookDispatcher.
 *
 * IMPORTANT: This function catches all errors internally. It must never throw
 * or block the calling handler.
 */
export async function dispatchTaskWebhooks(
  userId: string,
  event: TaskWebhookEvent
): Promise<void> {
  try {
    const db = getFirestore();

    // Query all enabled webhooks
    const snapshot = await db
      .collection(`tenants/${userId}/webhooks`)
      .where("enabled", "==", true)
      .get();

    if (snapshot.empty) {
      return; // No webhooks registered
    }

    const webhooks = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as WebhookRegistration[];

    // Filter webhooks that subscribe to this event type and match task filters
    const matchingWebhooks = webhooks.filter((webhook) => {
      // Check if webhook subscribes to this event
      if (!webhook.events.includes(event.event)) {
        return false;
      }

      // Check if task matches webhook's filter
      return matchesFilter(event.task, webhook.filter);
    });

    if (matchingWebhooks.length === 0) {
      return; // No matching webhooks
    }

    // Dispatch to each matching webhook
    const dispatchPromises = matchingWebhooks.map(async (webhook) => {
      try {
        // Build subscription object for webhookDispatcher
        const subscription: WebhookSubscription = {
          id: webhook.id,
          callbackUrl: webhook.callbackUrl,
          secret: webhook.secret || undefined,
          programId: webhook.createdBy,
          namespace: "task-events",
          key: event.event,
        };

        // Build webhook event payload
        const webhookEvent: WebhookEvent = {
          event: event.event,
          taskId: event.taskId,
          task: event.task,
          timestamp: event.timestamp,
          tenantId: event.tenantId,
        };

        // Dispatch (with retries handled internally)
        const success = await dispatchWebhook(subscription, webhookEvent, userId);

        // Log delivery result
        await db.collection(`tenants/${userId}/webhook_deliveries`).add({
          webhookId: webhook.id,
          event: event.event,
          taskId: event.taskId,
          status: success ? "success" : "failed",
          statusCode: null, // Not available from dispatchWebhook
          attempt: success ? 1 : 3, // Simplified: 1 on success, 3 on failure
          timestamp: new Date().toISOString(),
          error: success ? null : "Delivery failed after 3 retries",
          payload: webhookEvent,
        });

        console.log(
          `[TaskWebhook] ${success ? "Success" : "Failed"}: ${event.event} for task ${event.taskId} to ${webhook.callbackUrl}`
        );
      } catch (error) {
        console.error(`[TaskWebhook] Error dispatching to webhook ${webhook.id}:`, error);
      }
    });

    // Wait for all dispatches to complete (fire-and-forget at the handler level)
    await Promise.all(dispatchPromises);
  } catch (error) {
    // Swallow all errors - never throw from this function
    console.error("[TaskWebhook] Fatal error in dispatchTaskWebhooks:", error);
  }
}
