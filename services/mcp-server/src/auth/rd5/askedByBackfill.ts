/**
 * RD-5 PR-L (20.1 item 3): backfill `askedBy` on question tasks written before signal_ask_question recorded it.
 * The CLI is scripts/rd5/backfill-asked-by.ts. Dry-run by default; nothing is written without apply.
 *
 * askedBy is set from the question task's `source`. A question whose source is not a program name (signal_ask_question
 * wrote the literal "program" before PR-L, and "user" marks an owner-authored row) is skipped and counted: there is no
 * principal to copy. Only `askedBy` is written, one update per document.
 */

export interface AskedByDb {
  collection(path: string): {
    where(field: string, op: "==", value: unknown): { get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown>; ref: unknown }> }> };
  };
  batch(): { update(ref: unknown, data: Record<string, unknown>): unknown; commit(): Promise<unknown> };
}

export interface AskedByResult {
  ok: boolean;
  lines: string[];
  counts: { scanned: number; alreadySet: number; planned: number; skippedNoPrincipal: number; written: number };
}

const NOT_A_PRINCIPAL = new Set(["", "program", "user"]);
const BATCH_SIZE = 400;

export async function runAskedByBackfill(db: AskedByDb, opts: { tenantUid: string; apply: boolean }): Promise<AskedByResult> {
  const lines: string[] = [];
  const counts = { scanned: 0, alreadySet: 0, planned: 0, skippedNoPrincipal: 0, written: 0 };
  if (!opts.tenantUid) return { ok: false, lines: ["--tenant is required"], counts };

  const snap = await db.collection(`tenants/${opts.tenantUid}/tasks`).where("type", "==", "question").get();
  const plan: Array<{ id: string; ref: unknown; askedBy: string }> = [];
  for (const doc of snap.docs) {
    counts.scanned++;
    const d = doc.data();
    if (typeof d.askedBy === "string" && d.askedBy !== "") { counts.alreadySet++; continue; }
    const source = typeof d.source === "string" ? d.source : "";
    if (NOT_A_PRINCIPAL.has(source)) { counts.skippedNoPrincipal++; lines.push(`skip ${doc.id}: source "${source}" is not a program principal`); continue; }
    counts.planned++;
    plan.push({ id: doc.id, ref: doc.ref, askedBy: source });
    lines.push(`${opts.apply ? "set" : "would set"} ${doc.id}: askedBy="${source}"`);
  }

  if (opts.apply) {
    for (let i = 0; i < plan.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const p of plan.slice(i, i + BATCH_SIZE)) batch.update(p.ref, { askedBy: p.askedBy });
      await batch.commit();
      counts.written += Math.min(BATCH_SIZE, plan.length - i);
    }
  }
  lines.push(`${opts.apply ? "APPLIED" : "DRY RUN (no writes; pass --apply)"}: scanned ${counts.scanned}, already set ${counts.alreadySet}, planned ${counts.planned}, skipped ${counts.skippedNoPrincipal}, written ${counts.written}`);
  return { ok: true, lines, counts };
}
