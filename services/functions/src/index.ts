import * as admin from "firebase-admin";

admin.initializeApp();

// Auth triggers
export { onUserCreate } from "./auth/onUserCreate";

// Key management (callable)
export { createUserKey, revokeUserKey, updateKeyLabel } from "./auth/keyManagement";

// CLI auth (HTTP)
export { cliAuthApprove, cliAuthStatus } from "./auth/cliAuth";

// GitHub OAuth token exchange (HTTP)
export { exchangeGithubCode } from "./auth/githubOAuthExchange";

// Notification triggers (new collection paths)
export { onTaskCreate } from "./notifications/onTaskCreate";
export { onTaskUpdate } from "./notifications/onTaskUpdate";
export { onSessionUpdate } from "./notifications/onSessionUpdate";
export { onRelayCreate } from "./notifications/onRelayCreate";

// Analytics aggregation
export { onAnalyticsEventCreate } from "./analytics/onAnalyticsEventCreate";

// Pattern promotion, enforcement, and gap detection
export { onProgramStateWrite } from "./patterns/onProgramStateWrite";
export { onTaskCompleteFailed } from "./patterns/onTaskComplete";
export { onSessionComplete } from "./patterns/onSessionComplete";

// Scheduled cleanup
export { cleanupExpiredSessions } from "./cleanup/cleanupExpiredSessions";
export { cleanupOrphanedTasks } from "./cleanup/cleanupOrphanedTasks";
export { cleanupExpiredRelay } from "./cleanup/cleanupExpiredRelay";
export { cleanupLedger } from "./cleanup/cleanupLedger";
export { processDeadLetters } from "./cleanup/processDeadLetters";
export { cleanupAudit } from "./cleanup/cleanupAudit";

// Feedback
export { submitFeedback } from "./feedback/submitFeedback";

// Webhooks (HTTP)
export { onEasBuild } from "./webhooks/onEasBuild";
