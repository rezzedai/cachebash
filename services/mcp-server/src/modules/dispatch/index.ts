/**
 * Dispatch Module — Barrel export.
 * Maintains the existing API surface for consumers.
 */

export { getTasksHandler, getTaskByIdHandler, createTaskHandler } from "./tasks.js";
export { claimTaskHandler, unclaimTaskHandler, batchClaimTasksHandler } from "./claims.js";
export { completeTaskHandler, batchCompleteTasksHandler } from "./completion.js";
export { getContentionMetricsHandler } from "./contention.js";
