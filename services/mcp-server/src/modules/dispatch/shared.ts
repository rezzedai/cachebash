/**
 * Dispatch Module — Shared types and utilities.
 */

import { isEncrypted, decrypt } from "../../encryption/crypto.js";

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
