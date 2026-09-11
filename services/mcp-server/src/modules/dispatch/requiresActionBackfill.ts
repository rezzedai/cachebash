/**
 * WP-1 — pure-ish classification + scan/write logic for backfilling
 * `requires_action` onto task documents that predate the WP-1 write-site
 * fixes and have no requires_action field at all.
 *
 * Lives under src/ (unlike scripts/backfill-requires-action.ts, the CLI
 * entrypoint that imports this module) so it is covered by this package's
 * own `tsc` build/typecheck and can be exercised directly from jest against
 * an injected fake/mock Firestore — same split as expiresAtBackfillClassifier.ts
 * (pure classification, importable from both a script and a future service
 * path) plus backfillExpiresAt.ts (the batched scan/write loop), combined
 * here into one module since WP-1's execution path is a standalone script,
 * not an MCP tool handler.
 *
 * SCOPE: tenants/{tenant}/tasks documents where status == "created" AND the
 * requires_action field is missing entirely. Firestore cannot query "field
 * does not exist" directly, so this pages the status=="created" slice
 * ordered by document id and filters client-side for
 * `requires_action === undefined`.
 *
 * CLASSIFICATION: false when target === "user" (mobile-app-visibility
 * artifacts — informational, never claimed by a program's own get_tasks()
 * poll), true otherwise (scheduled/program-directed work is actionable by
 * default). See the WP-1 PR body for the full rationale and the list of
 * write sites this backfill exists to catch up.
 */

import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";

// Firestore's per-batch write cap is 500; this is not caller-tunable.
const BATCH_WRITE_MAX = 500;
const PAGE_SIZE = 1000;

/** Minimal shape this classifier reads — deliberately narrow. */
export interface ClassifiableTaskData {
  target?: string | null;
  requires_action?: unknown;
  status?: string;
}

/**
 * Pure classification rule: false for target:"user" (mobile-visibility /
 * informational, never a program's own get_tasks() claim target), true for
 * everything else (scheduled/program-directed work is actionable by default).
 */
export function classifyRequiresActionForBackfill(data: ClassifiableTaskData): boolean {
  return data.target !== "user";
}

export interface BackfillCounts {
  scanned: number;
  missingFieldFound: number;
  byTargetWouldUpdate: Record<string, number>;
  classifiedFalse: number;
  classifiedTrue: number;
}

export interface BackfillResult extends BackfillCounts {
  mode: "DRY-RUN" | "APPLY";
  updatedCount: number;
  updatedIdsSample: string[];
  errors: Array<{ id: string; error: string }>;
  limited: boolean;
}

export interface BackfillOptions {
  apply: boolean;
  limit?: number;
}

/** Minimal Firestore surface this function needs — lets tests inject a fake/mock. */
export interface BackfillableFirestore {
  collection(path: string): FirebaseFirestore.CollectionReference;
  batch(): FirebaseFirestore.WriteBatch;
}

/**
 * Scans tenants/{tenantId}/tasks where status=="created", classifies every
 * doc missing requires_action, and (if options.apply) writes the field in
 * batches of <=500 with per-item error isolation on write failure.
 */
export async function runRequiresActionBackfill(
  db: BackfillableFirestore,
  tenantId: string,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const col = db.collection(`tenants/${tenantId}/tasks`).where("status", "==", "created");

  const counts: BackfillCounts = {
    scanned: 0,
    missingFieldFound: 0,
    byTargetWouldUpdate: {},
    classifiedFalse: 0,
    classifiedTrue: 0,
  };
  const errors: Array<{ id: string; error: string }> = [];
  const updatedIds: string[] = [];

  // Pending doc refs + their target classification, flushed in batches of
  // <=500. Buffered rather than written immediately so we can batch.
  let pending: Array<{ ref: FirebaseFirestore.DocumentReference; requiresAction: boolean; id: string }> = [];

  async function flush(): Promise<void> {
    if (pending.length === 0) return;
    const chunk = pending;
    pending = [];

    if (!options.apply) return; // dry-run never writes

    // Fast path: one atomic batch for the whole chunk.
    try {
      const batch = db.batch();
      for (const item of chunk) {
        batch.update(item.ref, { requires_action: item.requiresAction });
      }
      await batch.commit();
      for (const item of chunk) updatedIds.push(item.id);
      return;
    } catch (batchErr) {
      // Per-item error isolation: the atomic batch failed (e.g. one
      // malformed/missing doc) -- fall back to writing this chunk one
      // document at a time so a single bad doc cannot take down its
      // batch-mates. Each failure is caught, logged, and skipped.
      for (const item of chunk) {
        try {
          await item.ref.update({ requires_action: item.requiresAction });
          updatedIds.push(item.id);
        } catch (itemErr) {
          errors.push({
            id: item.id,
            error: itemErr instanceof Error ? itemErr.message : String(itemErr),
          });
        }
      }
    }
  }

  let lastDoc: QueryDocumentSnapshot | null = null;

  scan: for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      counts.scanned++;
      const data = doc.data() as ClassifiableTaskData;
      if (data.requires_action !== undefined) continue; // already classified -- never touched again (idempotent)

      counts.missingFieldFound++;
      const targetKey = data.target == null ? "(no target)" : String(data.target);
      counts.byTargetWouldUpdate[targetKey] = (counts.byTargetWouldUpdate[targetKey] || 0) + 1;

      const requiresAction = classifyRequiresActionForBackfill(data);
      if (requiresAction) counts.classifiedTrue++;
      else counts.classifiedFalse++;

      pending.push({ ref: doc.ref, requiresAction, id: doc.id });
      if (pending.length >= BATCH_WRITE_MAX) await flush();

      if (options.limit && counts.missingFieldFound >= options.limit) break scan;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  await flush();

  return {
    ...counts,
    mode: options.apply ? "APPLY" : "DRY-RUN",
    updatedCount: updatedIds.length,
    updatedIdsSample: updatedIds.slice(0, 20),
    errors,
    limited: options.limit !== undefined,
  };
}
