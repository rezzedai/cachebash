/**
 * Decay program state.
 *
 * Runs nightly (Cloud Scheduler). Applies decay rules to every program_state
 * document, per the `decay` object in grid/schemas/program.schema.json:
 *   - contextSummaryTTLDays : clear stale context summaries for completed tasks
 *   - learnedPatternMaxAge  : stale unreinforced learned patterns (flat age — NO
 *                             per-domain half-lives; deferred, OPP-3)
 *   - maxUnpromotedPatterns : evict oldest/weakest unpromoted patterns over the cap
 * Baseline reset (90d) is retained from prior behavior and emits a baselines_reset
 * action (the schema decayLog enum anticipates it).
 *
 * ── OPP-3 FIRST DEPLOY = PROPOSE-ONLY / DRY-RUN ──────────────────────────────
 * DRY_RUN is true: decay COMPUTES every action it would take and writes typed
 * entries to decay.decayLog (and STATE_DECAY telemetry), but performs NO state
 * mutation — nothing is staled, evicted, cleared, or reset. This measures whether
 * the orphaned-pattern problem is real before any destructive change. Flipping
 * DRY_RUN to false (separate follow-up, SARK gate) enables eviction.
 *
 * RUN-ORDER — PROMOTION BEFORE EVICTION: promotion is event-driven (onProgramStateWrite
 * fires the moment a pattern qualifies). Decay additionally guards a grace window:
 * any pattern that currently meets promotion criteria (isPromotable) is NEVER staled
 * or evicted here, so a pattern about to qualify can never be lost to decay.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { emitEvent } from "../util/emitEvent";
import { isPromotable, LearnedPattern } from "../patterns/onProgramStateWrite";

// OPP-3: PROPOSE-ONLY first deploy. Set to true to enable destructive mutation
// (staling, eviction, context clear, baseline reset). Keep false until the
// dry-run validates N nights and SARK signs off (Decision #15c).
const EVICTION_ENABLED = false;
const DRY_RUN = !EVICTION_ENABLED;

const CONTEXT_TTL_DAYS = 7;
const PATTERN_MAX_AGE_DAYS = 30;
const BASELINE_TTL_DAYS = 90;
const MAX_UNPROMOTED_PATTERNS = 50;
const MAX_DECAY_LOG_ENTRIES = 100;

type DecayActionType =
  | "context_cleared"
  | "pattern_staled"
  | "pattern_evicted"
  | "baselines_reset";

interface DecayAction {
  timestamp: string;
  action: DecayActionType;
  detail: string;
}

interface DecayResult {
  actions: DecayAction[];
  counts: Record<DecayActionType, number>;
}

export const decayProgramState = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();

    functions.logger.info(
      `[decayProgramState] Starting scheduled decay run (DRY_RUN=${DRY_RUN})`
    );

    try {
      const snapshot = await db.collectionGroup("program_state").get();

      if (snapshot.empty) {
        functions.logger.info("[decayProgramState] No program state documents found");
        return { processed: 0, dryRun: DRY_RUN };
      }

      let batch = db.batch();
      let batchCount = 0;
      let totalProcessed = 0;
      const totals: Record<DecayActionType, number> = {
        context_cleared: 0,
        pattern_staled: 0,
        pattern_evicted: 0,
        baselines_reset: 0,
      };

      for (const doc of snapshot.docs) {
        const state = doc.data();
        // computeAndApply mutates `state` in place only when DRY_RUN is false.
        const result = computeAndApply(state, now, DRY_RUN);

        if (result.actions.length === 0) continue;

        // Record proposed/applied actions on the document (typed decayLog +
        // lastDecayRun). This write happens in BOTH modes — in dry-run it is the
        // proposal record; the pattern/context/baseline fields are untouched.
        const decay = state.decay || {};
        const existingLog: DecayAction[] = Array.isArray(decay.decayLog)
          ? decay.decayLog
          : [];
        state.decay = {
          ...decay,
          lastDecayRun: new Date(now).toISOString(),
          decayLog: [...existingLog, ...result.actions].slice(-MAX_DECAY_LOG_ENTRIES),
        };

        batch.update(doc.ref, { decay: state.decay });
        batchCount++;
        totalProcessed++;
        for (const k of Object.keys(totals) as DecayActionType[]) {
          totals[k] += result.counts[k];
        }

        // Per-program telemetry — captures decay rate for the dry-run measurement.
        const programId = (state.programId as string) || doc.id;
        const userId = extractUserId(doc.ref.path);
        if (userId) {
          emitEvent(db, userId, {
            event_type: "STATE_DECAY",
            program_id: programId,
            dry_run: DRY_RUN,
            context_cleared: totals_of(result, "context_cleared"),
            patterns_staled: totals_of(result, "pattern_staled"),
            patterns_evicted: totals_of(result, "pattern_evicted"),
            baselines_reset: totals_of(result, "baselines_reset"),
          });
        }

        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      functions.logger.info(
        `[decayProgramState] Completed (DRY_RUN=${DRY_RUN}). Processed: ${totalProcessed}, ` +
          `staled: ${totals.pattern_staled}, evicted: ${totals.pattern_evicted}, ` +
          `contexts cleared: ${totals.context_cleared}, baselines reset: ${totals.baselines_reset}`
      );

      return {
        processed: totalProcessed,
        dryRun: DRY_RUN,
        patternsStaled: totals.pattern_staled,
        patternsEvicted: totals.pattern_evicted,
        contextsCleared: totals.context_cleared,
        baselinesReset: totals.baselines_reset,
      };
    } catch (error) {
      functions.logger.error("[decayProgramState] Error:", error);
      throw error;
    }
  });

function totals_of(result: DecayResult, action: DecayActionType): number {
  return result.counts[action];
}

/**
 * Compute the decay actions for a program state. When `dryRun` is false, also
 * mutates `state` in place (stale flags, context clear, baseline reset). When
 * true, computes the typed action log WITHOUT mutating decayable fields.
 *
 * Pure w.r.t. I/O and time (takes `now`) so it is unit-testable.
 */
export function computeAndApply(
  state: any,
  now: number,
  dryRun: boolean
): DecayResult {
  const decay = state.decay || {};
  const actions: DecayAction[] = [];
  const ts = new Date(now).toISOString();
  const counts: Record<DecayActionType, number> = {
    context_cleared: 0,
    pattern_staled: 0,
    pattern_evicted: 0,
    baselines_reset: 0,
  };

  const record = (action: DecayActionType, detail: string) => {
    actions.push({ timestamp: ts, action, detail });
    counts[action]++;
  };

  // Rule 1: Context Summary TTL — clear summaries for completed tasks past TTL.
  const contextTTLDays = decay.contextSummaryTTLDays || CONTEXT_TTL_DAYS;
  if (state.contextSummary?.lastTask?.outcome === "completed") {
    const updatedAt = parseTimestamp(state.lastUpdatedAt);
    const ttlMs = contextTTLDays * 24 * 60 * 60 * 1000;
    if (updatedAt > 0 && now - updatedAt > ttlMs) {
      record(
        "context_cleared",
        `Context summary for completed task '${state.contextSummary.lastTask.taskId || "?"}' aged past ${contextTTLDays}d TTL`
      );
      if (!dryRun) {
        state.contextSummary = {
          lastTask: null,
          activeWorkItems: [],
          handoffNotes: "",
          openQuestions: [],
        };
      }
    }
  }

  // Rule 2: Learned Pattern Max Age (flat) — stale unreinforced patterns.
  // GRACE WINDOW: never stale a pattern that currently meets promotion criteria
  // (promotion-before-eviction). Promoted patterns never decay.
  const maxAgeDays = decay.learnedPatternMaxAge || PATTERN_MAX_AGE_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (Array.isArray(state.learnedPatterns)) {
    for (const pattern of state.learnedPatterns as LearnedPattern[]) {
      if (pattern.stale) continue;
      if (pattern.promotedToStore) continue;
      if (isPromotable(pattern)) continue; // grace window — about to be promoted
      const reinforced = parseTimestamp(pattern.lastReinforced);
      if (reinforced > 0 && now - reinforced > maxAgeMs) {
        record(
          "pattern_staled",
          `Pattern '${pattern.id}' (domain ${pattern.domain}) unreinforced past ${maxAgeDays}d`
        );
        if (!dryRun) pattern.stale = true;
      }
    }
  }

  // Rule 3: Baselines TTL — reset stale performance baselines (preserve count).
  if (state.baselines) {
    const updatedAt = parseTimestamp(state.lastUpdatedAt);
    const ttlMs = BASELINE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const hasData =
      state.baselines.avgTaskDurationMinutes !== null ||
      state.baselines.lastSessionDurationMinutes !== null ||
      (state.baselines.commonFailureModes || []).length > 0;
    if (updatedAt > 0 && now - updatedAt > ttlMs && hasData) {
      record("baselines_reset", `Performance baselines aged past ${BASELINE_TTL_DAYS}d`);
      if (!dryRun) {
        state.baselines = {
          avgTaskDurationMinutes: null,
          lastSessionDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: state.baselines.sessionsCompleted || 0,
        };
      }
    }
  }

  // Rule 4: Max Unpromoted Patterns — evict weakest over the cap.
  // GRACE WINDOW applies here too: promotion-eligible patterns are excluded from
  // the eviction candidate set.
  const maxUnpromoted = decay.maxUnpromotedPatterns || MAX_UNPROMOTED_PATTERNS;
  if (Array.isArray(state.learnedPatterns)) {
    const evictable = (state.learnedPatterns as LearnedPattern[]).filter(
      (p) => !p.promotedToStore && !p.stale && !isPromotable(p)
    );
    if (evictable.length > maxUnpromoted) {
      // Evict lowest-confidence first.
      evictable.sort((a, b) => a.confidence - b.confidence);
      const excess = evictable.slice(0, evictable.length - maxUnpromoted);
      for (const p of excess) {
        record(
          "pattern_evicted",
          `Pattern '${p.id}' (domain ${p.domain}, confidence ${p.confidence}) over unpromoted cap of ${maxUnpromoted}`
        );
        if (!dryRun) p.stale = true;
      }
    }
  }

  return { actions, counts };
}

/** Extract `{userId}` from a `tenants/{userId}/sessions/_meta/program_state/{id}` path. */
function extractUserId(path: string): string | null {
  const parts = path.split("/");
  const idx = parts.indexOf("tenants");
  return idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : null;
}

/**
 * Parse Firestore timestamp to milliseconds.
 * Handles ISO strings, Firestore Timestamp objects, and { _seconds } shapes.
 */
function parseTimestamp(timestamp: any): number {
  if (typeof timestamp === "string") {
    const ms = new Date(timestamp).getTime();
    return isNaN(ms) ? 0 : ms;
  }
  if (timestamp?._seconds) {
    return timestamp._seconds * 1000;
  }
  if (timestamp?.toDate) {
    return timestamp.toDate().getTime();
  }
  return 0;
}
