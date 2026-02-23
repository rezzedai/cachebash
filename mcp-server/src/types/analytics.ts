/**
 * Analytics Event Types
 *
 * Product analytics for CacheBash usage patterns.
 * NEVER captures content — only metadata.
 *
 * Privacy enforcement is architectural: the emitter function
 * signature physically cannot accept message body, task instructions,
 * or question text.
 */

/** Event type taxonomy */
export type AnalyticsEventType =
  | "tool_call"
  | "task_lifecycle"
  | "message_lifecycle"
  | "session_lifecycle"
  | "sprint_lifecycle"
  | "error"
  | "auth"
  | "schema_validation";

/**
 * The full analytics event as stored in Firestore.
 * Collection: users/{uid}/analytics_events
 */
export interface AnalyticsEvent {
  // Identity
  accountId: string;
  programId?: string;
  sessionId?: string;
  clientPlatform?: string;

  // Event
  eventType: AnalyticsEventType;
  toolName?: string;
  timestamp: string; // ISO 8601

  // Context (envelope metadata only — NEVER content)
  messageType?: string;
  taskType?: string;
  priority?: string;
  action?: string;

  // Outcome
  success: boolean;
  errorCode?: string;
  errorClass?: string;
  latencyMs?: number;

  // Lifecycle timing (for funnel analysis)
  taskCreatedAt?: string;
  taskClaimedAt?: string;
  taskCompletedAt?: string;
  messageCreatedAt?: string;
  messageDeliveredAt?: string;
  messageReadAt?: string;
}
