/**
 * Decay program state.
 * Runs every 24 hours. Applies decay rules to all program state documents:
 * - 7d context: Clear stale context summaries for completed tasks
 * - 30d patterns: Mark unreinforced learned patterns as stale
 * - 90d baselines: Reset performance baselines
 * - 50 cap: Enforce max unpromoted patterns
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const CONTEXT_TTL_DAYS = 7;
const PATTERN_MAX_AGE_DAYS = 30;
const BASELINE_TTL_DAYS = 90;
const MAX_UNPROMOTED_PATTERNS = 50;

interface DecayStats {
  patternsMarkedStale: number;
  contextCleared: boolean;
  baselinesReset: boolean;
}

export const decayProgramState = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();

    functions.logger.info("[decayProgramState] Starting scheduled decay run");

    try {
      // Query all program state documents across all tenants
      const snapshot = await db.collectionGroup("program_state").get();

      if (snapshot.empty) {
        functions.logger.info("[decayProgramState] No program state documents found");
        return { processed: 0 };
      }

      let batch = db.batch();
      let batchCount = 0;
      let totalProcessed = 0;
      let totalPatternsStaled = 0;
      let totalContextsCleared = 0;
      let totalBaselinesReset = 0;

      for (const doc of snapshot.docs) {
        const state = doc.data();
        const stats = applyDecayRules(state, now);

        // If any decay occurred, update the document
        if (stats.patternsMarkedStale > 0 || stats.contextCleared || stats.baselinesReset) {
          batch.update(doc.ref, state);
          batchCount++;
          totalProcessed++;
          totalPatternsStaled += stats.patternsMarkedStale;
          if (stats.contextCleared) totalContextsCleared++;
          if (stats.baselinesReset) totalBaselinesReset++;

          // Commit batch if we hit 500 operations
          if (batchCount >= 500) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
      }

      // Commit remaining batch
      if (batchCount > 0) {
        await batch.commit();
      }

      functions.logger.info(
        `[decayProgramState] Completed. Processed: ${totalProcessed}, Patterns staled: ${totalPatternsStaled}, Contexts cleared: ${totalContextsCleared}, Baselines reset: ${totalBaselinesReset}`
      );

      return {
        processed: totalProcessed,
        patternsStaled: totalPatternsStaled,
        contextsCleared: totalContextsCleared,
        baselinesReset: totalBaselinesReset,
      };
    } catch (error) {
      functions.logger.error("[decayProgramState] Error:", error);
      throw error;
    }
  });

/**
 * Apply decay rules to a program state document.
 * Mutates the state object in place.
 */
function applyDecayRules(state: any, now: number): DecayStats {
  const decay = state.decay || {};
  let patternsMarkedStale = 0;
  let contextCleared = false;
  let baselinesReset = false;
  let decayed = false;

  // Rule 1: Context Summary TTL (7 days)
  const contextTTLDays = decay.contextSummaryTTLDays || CONTEXT_TTL_DAYS;
  if (state.contextSummary?.lastTask) {
    const lastTask = state.contextSummary.lastTask;
    // Only clear if task was completed (not in-progress or blocked)
    if (lastTask.outcome === "completed") {
      const lastUpdated = state.lastUpdatedAt;
      if (lastUpdated) {
        const updatedAt = parseTimestamp(lastUpdated);
        const ttlMs = contextTTLDays * 24 * 60 * 60 * 1000;
        if (updatedAt > 0 && now - updatedAt > ttlMs) {
          state.contextSummary = {
            lastTask: null,
            activeWorkItems: [],
            handoffNotes: "",
            openQuestions: [],
          };
          contextCleared = true;
          decayed = true;
        }
      }
    }
  }

  // Rule 2: Learned Pattern Max Age (30 days)
  const maxAgeDays = decay.learnedPatternMaxAge || PATTERN_MAX_AGE_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (Array.isArray(state.learnedPatterns)) {
    for (const pattern of state.learnedPatterns) {
      if (pattern.stale) continue; // already stale
      if (pattern.promotedToStore) continue; // promoted patterns don't decay
      const reinforced = parseTimestamp(pattern.lastReinforced);
      if (!isNaN(reinforced) && now - reinforced > maxAgeMs) {
        pattern.stale = true;
        patternsMarkedStale++;
        decayed = true;
      }
    }
  }

  // Rule 3: Baselines TTL (90 days) — NEW
  const baselineTTLDays = BASELINE_TTL_DAYS;
  if (state.baselines) {
    const lastUpdated = state.lastUpdatedAt;
    if (lastUpdated) {
      const updatedAt = parseTimestamp(lastUpdated);
      const ttlMs = baselineTTLDays * 24 * 60 * 60 * 1000;
      if (
        updatedAt > 0 &&
        now - updatedAt > ttlMs &&
        (state.baselines.avgTaskDurationMinutes !== null ||
          state.baselines.lastSessionDurationMinutes !== null ||
          state.baselines.commonFailureModes.length > 0)
      ) {
        state.baselines = {
          avgTaskDurationMinutes: null,
          lastSessionDurationMinutes: null,
          commonFailureModes: [],
          sessionsCompleted: state.baselines.sessionsCompleted || 0, // preserve count
        };
        baselinesReset = true;
        decayed = true;
      }
    }
  }

  // Rule 4: Max Unpromoted Patterns (50 cap)
  const maxUnpromoted = decay.maxUnpromotedPatterns || MAX_UNPROMOTED_PATTERNS;
  if (Array.isArray(state.learnedPatterns)) {
    const unpromoted = state.learnedPatterns.filter(
      (p: any) => !p.promotedToStore && !p.stale
    );
    if (unpromoted.length > maxUnpromoted) {
      unpromoted.sort((a: any, b: any) => a.confidence - b.confidence);
      const excess = unpromoted.slice(0, unpromoted.length - maxUnpromoted);
      for (const p of excess) {
        p.stale = true;
        patternsMarkedStale++;
        decayed = true;
      }
    }
  }

  // Update decay metadata
  if (decayed) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      patternsMarkedStale,
      contextCleared,
      baselinesReset,
    };

    state.decay = {
      ...decay,
      lastDecayRun: new Date().toISOString(),
      decayLog: [...(decay.decayLog || []).slice(-9), logEntry], // keep last 10 entries
    };
  }

  return { patternsMarkedStale, contextCleared, baselinesReset };
}

/**
 * Parse Firestore timestamp to milliseconds.
 * Handles: ISO strings, Firestore Timestamp objects, and raw { _seconds, _nanoseconds } objects.
 */
function parseTimestamp(timestamp: any): number {
  if (typeof timestamp === "string") {
    return new Date(timestamp).getTime();
  }
  if (timestamp?._seconds) {
    return timestamp._seconds * 1000;
  }
  if (timestamp?.toDate) {
    return timestamp.toDate().getTime();
  }
  return 0;
}
