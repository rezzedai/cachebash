import * as admin from "firebase-admin";

admin.initializeApp();

// Auth triggers
export { onUserCreate } from "./auth/onUserCreate";

// Notification triggers (new collection paths)
export { onTaskCreate } from "./notifications/onTaskCreate";
export { onTaskUpdate } from "./notifications/onTaskUpdate";
export { onSessionUpdate } from "./notifications/onSessionUpdate";
export { onRelayCreate } from "./notifications/onRelayCreate";

// Analytics aggregation
export { onAnalyticsEventCreate } from "./analytics/onAnalyticsEventCreate";

// Scheduled cleanup
export { cleanupExpiredSessions } from "./cleanup/cleanupExpiredSessions";
export { cleanupOrphanedTasks } from "./cleanup/cleanupOrphanedTasks";
export { cleanupExpiredRelay } from "./cleanup/cleanupExpiredRelay";
export { cleanupLedger } from "./cleanup/cleanupLedger";
export { processDeadLetters } from "./cleanup/processDeadLetters";
export { cleanupAudit } from "./cleanup/cleanupAudit";
