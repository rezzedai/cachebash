/**
 * Dispatch Module — Shared types and utilities.
 */

import { isEncrypted, decrypt } from "../../encryption/crypto.js";
import type { StateTransition } from "../../types/task.js";

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
