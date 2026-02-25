import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

interface LearnedPattern {
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
 * Triggered when program state is written.
 * Detects learnedPatterns that meet promotion criteria and creates tasks
 * for the originating program to write the pattern to the permanent store.
 *
 * Promotion criteria:
 * - confidence >= 0.7
 * - lastReinforced !== discoveredAt (reinforced at least once)
 * - stale === false
 * - promotedToStore === false
 */
export const onProgramStateWrite = functions.firestore
  .document("tenants/{userId}/sessions/_meta/program_state/{programId}")
  .onWrite(async (change, context) => {
    const { userId, programId } = context.params;

    // No document created (deletion) - skip
    if (!change.after.exists) {
      return;
    }

    const before: ProgramState = change.before.exists ? (change.before.data() as ProgramState) : {};
    const after: ProgramState = change.after.data() as ProgramState;

    const beforePatterns = before.learnedPatterns || [];
    const afterPatterns = after.learnedPatterns || [];

    // Find patterns that meet promotion criteria
    const patternsToPromote: LearnedPattern[] = [];
    const patternUpdates: { [key: string]: any } = {};

    afterPatterns.forEach((pattern, index) => {
      // Check if already promoted in before state (prevent re-trigger)
      const beforePattern = beforePatterns.find(p => p.id === pattern.id);
      if (beforePattern && beforePattern.promotedToStore === true) {
        return;
      }

      // Skip if already marked as promoted in after state
      if (pattern.promotedToStore === true) {
        return;
      }

      // Check promotion criteria
      const meetsConfidence = pattern.confidence >= 0.7;
      const isReinforced = pattern.lastReinforced !== pattern.discoveredAt;
      const notStale = pattern.stale !== true;

      if (meetsConfidence && isReinforced && notStale) {
        patternsToPromote.push(pattern);
        // Mark for promotion in the state document
        patternUpdates[`learnedPatterns.${index}.promotedToStore`] = true;
      }
    });

    if (patternsToPromote.length === 0) {
      return;
    }

    functions.logger.info(
      `Found ${patternsToPromote.length} patterns ready for promotion in ${programId}`
    );

    try {
      // Use batch to atomically create tasks and update promotion flags
      const batch = db.batch();

      // Create a task for each pattern
      for (const pattern of patternsToPromote) {
        const taskRef = db.collection(`tenants/${userId}/tasks`).doc();
        const slug = pattern.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");

        batch.set(taskRef, {
          type: "task",
          title: `Promote pattern: ${pattern.id} → grid/stores/patterns/${pattern.domain}/`,
          instructions: `Pattern '${pattern.id}' has reached promotion criteria (confidence: ${pattern.confidence}). Write it to grid/stores/patterns/${pattern.domain}/${slug}.md using the promotion format from grid/workflows/pattern-promotion.md. Pattern: "${pattern.pattern}". Evidence: "${pattern.evidence}".`,
          target: programId,
          source: "system",
          action: "queue",
          priority: "low",
          status: "created",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        functions.logger.info(
          `Created promotion task for pattern ${pattern.id} (confidence: ${pattern.confidence})`
        );
      }

      // Update the program state to mark patterns as promoted
      batch.update(change.after.ref, patternUpdates);

      await batch.commit();

      functions.logger.info(
        `Successfully created ${patternsToPromote.length} promotion tasks for ${programId}`
      );
    } catch (error) {
      functions.logger.error(
        `Failed to create promotion tasks for ${programId}`,
        error
      );
      throw error;
    }
  });
