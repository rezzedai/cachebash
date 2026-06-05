import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { emitEvent } from "../util/emitEvent";

/**
 * Promotion confidence threshold.
 *
 * SINGLE SOURCE OF TRUTH: grid/schemas/program.schema.json declares promotion at
 * confidence >= 0.8 (learnedPatterns.confidence description). grid/workflows/pattern-promotion.md
 * is reconciled to match. Do not change here without changing both. (Flynn decision, OPP-3.)
 */
const PROMOTION_CONFIDENCE_THRESHOLD = 0.8;

export interface LearnedPattern {
  id: string;
  domain: string;
  pattern: string;
  confidence: number;
  evidence: string;
  discoveredAt: string;
  lastReinforced: string;
  promotedToStore?: boolean;
  stale?: boolean;
}

interface ProgramState {
  learnedPatterns?: LearnedPattern[];
  [key: string]: any;
}

/**
 * Whether a pattern is eligible for promotion.
 *
 * Criteria (grid/workflows/pattern-promotion.md):
 * - confidence >= 0.8 (PROMOTION_CONFIDENCE_THRESHOLD)
 * - reinforced at least once (lastReinforced !== discoveredAt)
 * - not stale
 * - not already promoted
 */
export function isPromotable(pattern: LearnedPattern): boolean {
  const meetsConfidence = pattern.confidence >= PROMOTION_CONFIDENCE_THRESHOLD;
  const isReinforced = pattern.lastReinforced !== pattern.discoveredAt;
  const notStale = pattern.stale !== true;
  const notPromoted = pattern.promotedToStore !== true;
  return meetsConfidence && isReinforced && notStale && notPromoted;
}

/**
 * Compute the set of patterns to promote from a state transition, plus the
 * field-path updates that mark them promoted. Pure — no I/O — so it is unit-testable.
 *
 * A pattern is skipped if it was already promoted in the BEFORE state (prevents
 * re-trigger on subsequent writes).
 */
export function evaluatePromotion(
  beforePatterns: LearnedPattern[],
  afterPatterns: LearnedPattern[]
): { toPromote: LearnedPattern[]; updates: { [key: string]: any } } {
  const toPromote: LearnedPattern[] = [];
  const updates: { [key: string]: any } = {};

  afterPatterns.forEach((pattern, index) => {
    const beforePattern = beforePatterns.find((p) => p.id === pattern.id);
    if (beforePattern && beforePattern.promotedToStore === true) {
      return; // already promoted previously — don't re-trigger
    }
    if (isPromotable(pattern)) {
      toPromote.push(pattern);
      updates[`learnedPatterns.${index}.promotedToStore`] = true;
    }
  });

  return { toPromote, updates };
}

/**
 * Advisory duplicate detection.
 *
 * Checks whether another program has already promoted a pattern in the same
 * domain with substantially similar text. Returns the duplicate's location
 * (programId + patternId) or null. ADVISORY ONLY — never blocks promotion; the
 * created task carries the note so the program can decide to merge or fork.
 *
 * The permanent store lives in git (not queryable here), so dedup is best-effort
 * against the cross-program Firestore signal: patterns already flagged
 * promotedToStore in other programs' state.
 */
export function findDuplicate(
  candidate: LearnedPattern,
  otherPrograms: { programId: string; patterns: LearnedPattern[] }[]
): { programId: string; patternId: string } | null {
  for (const other of otherPrograms) {
    for (const p of other.patterns) {
      if (p.promotedToStore !== true) continue;
      if (p.domain !== candidate.domain) continue;
      if (textSimilarity(p.pattern, candidate.pattern) >= 0.6) {
        return { programId: other.programId, patternId: p.id };
      }
    }
  }
  return null;
}

/**
 * Jaccard similarity over normalized word sets. Cheap, dependency-free, good
 * enough for an advisory "have we seen this already" check.
 */
function textSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const setA = norm(a);
  const setB = norm(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Triggered when program state is written.
 *
 * Detects learnedPatterns that meet promotion criteria (confidence >= 0.8,
 * reinforced, not stale, not promoted) and creates a LOW-PRIORITY CacheBash task
 * for the originating program to write the pattern file to the permanent store.
 *
 * GUARDRAIL (non-negotiable, preserved): this function MUST NOT write git directly.
 * It creates a task ("task-not-commit") so git writes stay in program control.
 *
 * Emits a PATTERN_PROMOTED telemetry event per promoted pattern.
 */
export const onProgramStateWrite = functions.firestore
  .document("tenants/{userId}/sessions/_meta/program_state/{programId}")
  .onWrite(async (change, context) => {
    const { userId, programId } = context.params;
    const db = admin.firestore();

    // No document after write (deletion) — skip.
    if (!change.after.exists) {
      return;
    }

    const before: ProgramState = change.before.exists
      ? (change.before.data() as ProgramState)
      : {};
    const after: ProgramState = change.after.data() as ProgramState;

    const { toPromote, updates } = evaluatePromotion(
      before.learnedPatterns || [],
      after.learnedPatterns || []
    );

    if (toPromote.length === 0) {
      return;
    }

    functions.logger.info(
      `Found ${toPromote.length} patterns ready for promotion in ${programId}`
    );

    // Advisory cross-program dedup. Bounded single-collection read (one doc per
    // program, ~dozen docs) — intentionally NOT a collectionGroup query, so no
    // composite index and predictable cost. (ALAN cost/index note, OPP-3.)
    let otherPrograms: { programId: string; patterns: LearnedPattern[] }[] = [];
    try {
      const stateSnap = await db
        .collection(`tenants/${userId}/sessions/_meta/program_state`)
        .get();
      otherPrograms = stateSnap.docs
        .filter((d) => d.id !== programId)
        .map((d) => ({
          programId: d.id,
          patterns: (d.data().learnedPatterns || []) as LearnedPattern[],
        }));
    } catch (err) {
      // Dedup is advisory — a failure here must not block promotion.
      functions.logger.warn(
        `Dedup lookup failed for ${programId}; proceeding without dedup`,
        err
      );
    }

    try {
      // Atomic batch: create promotion tasks AND mark patterns promoted.
      const batch = db.batch();

      for (const pattern of toPromote) {
        const slug = pattern.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const duplicate = findDuplicate(pattern, otherPrograms);
        const dupNote = duplicate
          ? `Potential duplicate: program '${duplicate.programId}' already promoted pattern '${duplicate.patternId}' in this domain — review and merge or fork.`
          : "Potential duplicate: none found.";

        const taskRef = db.collection(`tenants/${userId}/tasks`).doc();
        batch.set(taskRef, {
          type: "task",
          title: `Promote pattern: ${pattern.id} → grid/stores/patterns/${pattern.domain}/`,
          instructions:
            `Pattern '${pattern.id}' has reached promotion criteria ` +
            `(confidence: ${pattern.confidence}). Write it to ` +
            `grid/stores/patterns/${pattern.domain}/${slug}.md using the promotion ` +
            `format from grid/workflows/pattern-promotion.md. ` +
            `Pattern: "${pattern.pattern}". Evidence: "${pattern.evidence}". ${dupNote}`,
          target: programId,
          source: "system",
          action: "queue",
          priority: "low",
          status: "created",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // PATTERN_PROMOTED telemetry — measures promotion rate (OPP-3 dry-run
        // also validates whether the orphaned-pattern problem is real).
        emitEvent(db, userId, {
          event_type: "PATTERN_PROMOTED",
          program_id: programId,
          pattern_id: pattern.id,
          domain: pattern.domain,
          confidence: pattern.confidence,
          duplicate_found: duplicate !== null,
        });

        functions.logger.info(
          `Created promotion task for pattern ${pattern.id} ` +
            `(confidence: ${pattern.confidence}, duplicate: ${duplicate !== null})`
        );
      }

      // Mark the promoted patterns in the state document.
      batch.update(change.after.ref, updates);

      await batch.commit();

      functions.logger.info(
        `Successfully created ${toPromote.length} promotion tasks for ${programId}`
      );
    } catch (error) {
      functions.logger.error(
        `Failed to create promotion tasks for ${programId}`,
        error
      );
      throw error;
    }
  });
