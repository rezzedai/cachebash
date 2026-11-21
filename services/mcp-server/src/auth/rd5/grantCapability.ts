/**
 * RD-5 PR-D: grant-capability logic (ISO plan section 9). The CLI is
 * scripts/rd5/grant-capability.ts.
 *
 * Adds one capability to one key document with one arrayUnion on
 * `capabilities`. It touches no other field. RD-5 PR-N N-D9 adds one removal
 * mode, `--remove-wildcard`, that removes exactly the wildcard (P2-5, run by ISO).
 * There is no other removal, rotate or revoke mode.
 *
 * It refuses a key whose `capabilities` field is missing, not an array, or an
 * empty array. The server reads a missing field or an empty array as the program's
 * default set (authValidator, keys rotate and list), so an arrayUnion would write a
 * one-element list and silently replace those defaults.
 */

import { ALL_CAPABILITIES } from "../../middleware/capabilities.js";

/** The one wildcard literal in non-test src (a static test allows exactly this line): what a grant refuses and the narrow removes. */
export const WILDCARD = "*";

export type GrantPlan =
  | { ok: true; before: string[]; after: string[]; alreadyHeld: boolean }
  | { ok: false; reason: string };

/** Same rules as validateApiKey: `active === false`, a `revokedAt`, or a past `expiresAt` make a key dead. */
export function planGrant(
  data: Record<string, unknown> | undefined,
  capability: string,
  now: Date = new Date()
): GrantPlan {
  if (typeof capability !== "string" || capability.trim() === "") {
    return { ok: false, reason: "--add requires a non-empty capability" };
  }
  if (capability === WILDCARD) {
    return { ok: false, reason: `refusing to add the wildcard ${WILDCARD}` };
  }
  if (!(ALL_CAPABILITIES as readonly string[]).includes(capability)) {
    const valid = ALL_CAPABILITIES.join(", ");
    return { ok: false, reason: `unknown capability ${capability}; valid: ${valid}` };
  }
  if (!data) return { ok: false, reason: "key document not found" };

  const caps = data.capabilities;
  if (caps === undefined || caps === null) {
    return {
      ok: false,
      reason:
        "capabilities field is missing: the server reads it as the program default set, and an arrayUnion would replace that set with one capability. STOP and report to ISO",
    };
  }
  if (!Array.isArray(caps)) {
    return { ok: false, reason: `capabilities is not an array (${typeof caps}): refusing` };
  }
  if (data.active === false) return { ok: false, reason: "key is inactive" };
  if (data.revokedAt) return { ok: false, reason: "key is revoked" };
  if (data.expiresAt !== undefined && data.expiresAt !== null) {
    const v = data.expiresAt as { toDate?: () => Date };
    const exp = typeof v.toDate === "function" ? v.toDate() : new Date(data.expiresAt as string | number);
    if (Number.isNaN(exp.getTime())) return { ok: false, reason: "expiresAt is unparseable: refusing" };
    if (exp < now) return { ok: false, reason: `key is expired (${exp.toISOString()})` };
  }

  if (caps.length === 0) {
    return {
      ok: false,
      reason:
        "capabilities is an empty array: the server reads [] as the program default set via getDefaultCapabilities(programId). An arrayUnion would write a one-element list and replace it. STOP and report to ISO",
    };
  }

  const before = caps.map(String);
  const alreadyHeld = before.includes(capability);
  return { ok: true, before, after: alreadyHeld ? before : [...before, capability], alreadyHeld };
}

export interface GrantTx {
  get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  update(ref: unknown, data: Record<string, unknown>): void;
}
export interface GrantDb {
  doc(path: string): unknown;
  runTransaction<T>(fn: (tx: GrantTx) => Promise<T>): Promise<T>;
}

export interface GrantOptions {
  keyHash: string;
  add: string;
  apply: boolean;
  /** FieldValue.arrayUnion, injected so tests need no Firestore. */
  arrayUnion: (...v: string[]) => unknown;
  now?: Date;
}

export interface GrantResult {
  ok: boolean;
  applied: boolean;
  lines: string[];
}

export async function runGrant(db: GrantDb, opts: GrantOptions): Promise<GrantResult> {
  if (!/^[0-9a-f]{64}$/.test(opts.keyHash)) {
    return { ok: false, applied: false, lines: ["REFUSED: --key-hash must be the full 64-hex keyIndex document id"] };
  }
  const ref = db.doc(`keyIndex/${opts.keyHash}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const plan = planGrant(snap.exists ? snap.data() : undefined, opts.add, opts.now);
    const id = opts.keyHash.slice(0, 8);
    if (!plan.ok) return { ok: false, applied: false, lines: [`REFUSED ${id}: ${plan.reason}`] };

    const lines = [
      `key ${id}`,
      `before: ${JSON.stringify(plan.before)}`,
      `after:  ${JSON.stringify(plan.after)}`,
    ];
    if (plan.alreadyHeld) {
      lines.push("no change: capability already held");
      return { ok: true, applied: false, lines };
    }
    if (!opts.apply) {
      lines.push("DRY RUN: nothing written. Re-run with --apply to write.");
      return { ok: true, applied: false, lines };
    }
    tx.update(ref, { capabilities: opts.arrayUnion(opts.add) });
    lines.push("APPLIED: one arrayUnion on capabilities");
    return { ok: true, applied: true, lines };
  });
}

export type RemovePlan = { ok: true; before: string[]; after: string[]; held: boolean } | { ok: false; reason: string };

/** RD-5 PR-N N-D9: removes exactly the wildcard. Refuses an empty result or a list lacking any `expect` capability. */
export function planRemoveWildcard(data: Record<string, unknown> | undefined, expect: string[]): RemovePlan {
  if (!data) return { ok: false, reason: "key document not found" };
  if (!Array.isArray(data.capabilities)) return { ok: false, reason: "capabilities is missing or not an array: refusing" };
  const before = data.capabilities.map(String);
  const after = before.filter((c) => c !== WILDCARD);
  const missing = expect.filter((c) => !before.includes(c));
  if (missing.length > 0) return { ok: false, reason: `list lacks expected capabilities: ${missing.join(", ")}` };
  if (after.length === 0) return { ok: false, reason: "removing the wildcard would leave an empty list" };
  return { ok: true, before, after, held: before.includes(WILDCARD) };
}

export interface RemoveOptions {
  keyHash: string;
  expect: string[];
  apply: boolean;
  /** FieldValue.arrayRemove, injected so tests need no Firestore. */
  arrayRemove: (...v: string[]) => unknown;
}

export async function runRemoveWildcard(db: GrantDb, opts: RemoveOptions): Promise<GrantResult> {
  if (!/^[0-9a-f]{64}$/.test(opts.keyHash)) {
    return { ok: false, applied: false, lines: ["REFUSED: --key-hash must be the full 64-hex keyIndex document id"] };
  }
  const ref = db.doc(`keyIndex/${opts.keyHash}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const plan = planRemoveWildcard(snap.exists ? snap.data() : undefined, opts.expect);
    const id = opts.keyHash.slice(0, 8);
    if (!plan.ok) return { ok: false, applied: false, lines: [`REFUSED ${id}: ${plan.reason}`] };
    const lines = [`key ${id}`, `before: ${JSON.stringify(plan.before)}`, `after:  ${JSON.stringify(plan.after)}`];
    if (!plan.held) { lines.push("no change: wildcard not held"); return { ok: true, applied: false, lines }; }
    if (!opts.apply) { lines.push("DRY RUN: nothing written. Re-run with --apply to write."); return { ok: true, applied: false, lines }; }
    tx.update(ref, { capabilities: opts.arrayRemove(WILDCARD) });
    lines.push("APPLIED: one arrayRemove of the wildcard on capabilities");
    return { ok: true, applied: true, lines };
  });
}
