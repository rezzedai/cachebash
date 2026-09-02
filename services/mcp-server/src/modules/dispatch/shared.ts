/**
 * Dispatch Module — Shared types and utilities.
 */

import { isEncrypted, decrypt } from "../../encryption/crypto.js";
import type { StateTransition } from "../../types/task.js";
import { LifecycleError } from "../../lifecycle/engine.js";

export type ToolResult = { content: Array<{ type: string; text: string }> };

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function decryptTaskFields(
  data: { title?: string; instructions?: string; encrypted?: boolean },
  key: Buffer
): { title: string; instructions: string } {
  if (!data.encrypted) {
    return { title: data.title || "", instructions: data.instructions || "" };
  }
  try {
    return {
      title: data.title && isEncrypted(data.title) ? decrypt(data.title, key) : data.title || "",
      instructions: data.instructions && isEncrypted(data.instructions)
        ? decrypt(data.instructions, key) : data.instructions || "",
    };
  } catch {
    return { title: data.title || "", instructions: data.instructions || "" };
  }
}

/**
 * Build a state transition entry.
 * Uses ISO string timestamps (not Firestore Timestamps) because
 * Firestore arrays of Timestamps have serialization edge cases.
 * Cap at MAX_TRANSITIONS to prevent unbounded growth.
 */
const MAX_TRANSITIONS = 50;

export function buildTransition(
  fromStatus: string,
  toStatus: string,
  actor: string,
  action?: string,
): StateTransition {
  return {
    fromStatus,
    toStatus,
    timestamp: new Date().toISOString(),
    actor,
    ...(action ? { action } : {}),
  };
}

/**
 * Append a transition to the existing array, enforcing the cap.
 * Returns the new array to set on the document.
 */
export function appendTransition(
  existing: StateTransition[] | undefined,
  entry: StateTransition,
): StateTransition[] {
  const arr = existing || [];
  const updated = [...arr, entry];
  // Trim oldest entries if over cap
  if (updated.length > MAX_TRANSITIONS) {
    return updated.slice(updated.length - MAX_TRANSITIONS);
  }
  return updated;
}

/**
 * Translate a task-completion failure into an actionable message.
 *
 * The lifecycle engine (src/lifecycle/engine.ts) is deliberately generic —
 * it validates transitions for tasks, sessions, dreams, and sprint-stories
 * alike, and has no concept of "claiming". So it cannot know that a task
 * sitting in "created" means "nobody has called dispatch_claim_task yet".
 * That task-specific remedy belongs here, at the task-completion call site,
 * not hardcoded into the generic engine (R2.1 — see
 * grid/plans/ISO-plan-dispatch-defects-1-and-2.md).
 *
 * For any other failure (auth errors, missing-task errors, or a
 * LifecycleError on a transition other than the unclaimed-task case) the
 * original message is returned unchanged.
 */
export function describeTaskCompletionError(taskId: string, error: unknown): string {
  if (error instanceof LifecycleError && error.entityType === "task" && error.from === "created") {
    return (
      `Invalid transition for task ${taskId}: created -> ${error.to}. ` +
      `A task must be claimed before it can be completed — call dispatch_claim_task first, then dispatch_complete_task.`
    );
  }
  return error instanceof Error ? error.message : String(error);
}
