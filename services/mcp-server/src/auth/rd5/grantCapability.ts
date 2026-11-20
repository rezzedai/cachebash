/**
 * RD-5 PR-D: grant-capability logic (ISO plan section 9). The CLI is
 * scripts/rd5/grant-capability.ts.
 *
 * Adds one capability to one key document with one arrayUnion on
 * `capabilities`. It touches no other field and has no remove, rotate or
 * revoke mode.
 *
 * It refuses a key whose `capabilities` field is missing, not an array, or an
 * empty array. The server reads a missing field as ["*"] (keys.ts:220, :283) and
 * an empty array as role defaults (authValidator.ts:83-85, key_identity), so an
 * arrayUnion would write a one-element list and silently strip the implicit
 * wildcard or defaults.
 */

import { ALL_CAPABILITIES } from "../../middleware/capabilities.js";

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
  if (capability === "*") {
    return { ok: false, reason: "refusing to add the wildcard \"*\"" };
  }
  if (!(ALL_CAPABILITIES as readonly string[]).includes(capability)) {
    const valid = ALL_CAPABILITIES.filter((c) => c !== "*").join(", ");
    return { ok: false, reason: `unknown capability ${capability}; valid: ${valid}` };
  }
  if (!data) return { ok: false, reason: "key document not found" };

  const caps = data.capabilities;
  if (caps === undefined || caps === null) {
    return {
      ok: false,
      reason:
        "capabilities field is missing: the server reads it as [\"*\"], and an arrayUnion would strip that wildcard. STOP and report to ISO",
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
        "capabilities is an empty array: authValidator.ts:83-85 reads [] as role defaults via getDefaultCapabilities(programId), which may include \"*\". An arrayUnion would write a one-element list and strip them. STOP and report to ISO",
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
