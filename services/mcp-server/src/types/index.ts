/**
 * CacheBash Type System — Re-exports
 *
 * Import from here: `import { Task, RelayMessage, Session } from '../types/index.js'`
 */

export type {
  ProgramId,
  Priority,
  Action,
  Provenance,
  Envelope,
  FirestoreTimestamp,
} from "./envelope.js";

export type {
  TaskType,
  QuestionData,
  DreamData,
  SprintConfig,
  SprintSummary,
  SprintData,
  Task,
} from "./task.js";

export type {
  RelayMessageType,
  RelayStatus,
  RelayMessage,
} from "./relay.js";
export { RELAY_DEFAULT_TTL_SECONDS } from "./relay.js";

export type { Session } from "./session.js";

export type { LedgerEntry } from "./ledger.js";

// Re-export lifecycle types
export type { LifecycleStatus, EntityType } from "../lifecycle/engine.js";
export {
  validateTransition,
  transition,
  TRANSITIONS,
} from "../lifecycle/engine.js";

// API Key types
export type { ApiKeyDoc } from "./apiKey.js";
export { REGISTERED_PROGRAMS, isRegisteredProgram, isValidProgram, SPECIAL_PROGRAMS } from "../config/programs.js";
export type { ProgramId as RegisteredProgramId, SpecialProgramId, ValidProgramId } from "../config/programs.js";
