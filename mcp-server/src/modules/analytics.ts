/**
 * Analytics Module — G-33 Tier 1-A
 *
 * Product analytics event emitter. Fire-and-forget.
 * Writes stripped metadata events to users/{uid}/analytics_events.
 *
 * PRIVACY BY DESIGN: This function's signature physically cannot
 * accept message body, task instructions, question text, or any
 * user-generated content. If it can't be passed in, it can't leak.
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import type { AnalyticsEventType } from "../types/analytics.js";

/**
 * Parameters for emitting an analytics event.
 *
 * This interface is intentionally restrictive — it accepts ONLY
 * metadata fields. Content fields (message body, instructions,
 * question text, program state) are excluded by design.
 */
export interface EmitAnalyticsParams {
  // Identity
  programId?: string;
  sessionId?: string;
  clientPlatform?: string;

  // Event classification
  eventType: AnalyticsEventType;
  toolName?: string;

  // Context (envelope metadata, never content)
  messageType?: string;
  taskType?: string;
  priority?: string;
  action?: string;

  // Outcome
  success: boolean;
  errorCode?: string;
  errorClass?: string;
  latencyMs?: number;

  // Lifecycle timing
  taskCreatedAt?: string;
  taskClaimedAt?: string;
  taskCompletedAt?: string;
  messageCreatedAt?: string;
  messageDeliveredAt?: string;
  messageReadAt?: string;
}

/**
 * Emit a product analytics event. Fire-and-forget — never blocks
 * the caller, never throws.
 *
 * @param userId - The Firestore user ID (written as accountId)
 * @param params - Metadata-only event parameters
 */
export function emitAnalyticsEvent(userId: string, params: EmitAnalyticsParams): void {
  try {
    const db = getFirestore();
    const event: Record<string, unknown> = {
      accountId: userId,
      eventType: params.eventType,
      success: params.success,
      timestamp: serverTimestamp(),
    };

    // Optional identity fields
    if (params.programId) event.programId = params.programId;
    if (params.sessionId) event.sessionId = params.sessionId;
    if (params.clientPlatform) event.clientPlatform = params.clientPlatform;

    // Optional event fields
    if (params.toolName) event.toolName = params.toolName;

    // Optional context fields (metadata only)
    if (params.messageType) event.messageType = params.messageType;
    if (params.taskType) event.taskType = params.taskType;
    if (params.priority) event.priority = params.priority;
    if (params.action) event.action = params.action;

    // Optional outcome fields
    if (params.errorCode) event.errorCode = params.errorCode;
    if (params.errorClass) event.errorClass = params.errorClass;
    if (params.latencyMs !== undefined) event.latencyMs = params.latencyMs;

    // Optional lifecycle timing
    if (params.taskCreatedAt) event.taskCreatedAt = params.taskCreatedAt;
    if (params.taskClaimedAt) event.taskClaimedAt = params.taskClaimedAt;
    if (params.taskCompletedAt) event.taskCompletedAt = params.taskCompletedAt;
    if (params.messageCreatedAt) event.messageCreatedAt = params.messageCreatedAt;
    if (params.messageDeliveredAt) event.messageDeliveredAt = params.messageDeliveredAt;
    if (params.messageReadAt) event.messageReadAt = params.messageReadAt;

    db.collection(`users/${userId}/analytics_events`).add(event).catch((err) => {
      console.error("[Analytics] Failed to write event:", err);
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Firebase not initialized")) {
      console.debug("[Analytics] Firebase not initialized; skipping analytics emission");
      return;
    }
    console.error("[Analytics] Failed to emit analytics event:", err);
  }
}
