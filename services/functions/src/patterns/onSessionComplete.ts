import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

/**
 * Grid programs that must extract patterns before derez.
 * Non-program sessions are skipped.
 */
const GRID_PROGRAMS = [
  "iso",
  "basher",
  "alan",
  "radia",
  "sark",
  "dumont",
  "castor",
  "scribe",
  "sage",
  "clu",
  "quorra",
  "casp",
  "gem",
  "rinzler",
  "link",
  "tron",
  "beck",
  "able",
  "bit",
  "byte",
  "system",
  "ram",
  "yori",
  "pixel",
  "tesler",
  "vector",
];

/**
 * BIT Derez Gate: Enforces pattern extraction before session completion.
 *
 * Triggered when a session state changes to "complete".
 * Checks if the program updated its learnedPatterns during the session.
 *
 * If check FAILS:
 * - Reverts session state to "working"
 * - Sends high-priority DIRECTIVE to program
 * - Blocks derez until pattern extraction completed
 *
 * If check PASSES:
 * - Logs approval
 * - Allows derez to proceed
 *
 * Error handling: Fail open (enforcement failure doesn't break derez).
 */
export const onSessionComplete = functions.firestore
  .document("tenants/{userId}/sessions/{sessionId}")
  .onUpdate(async (change, context) => {
    const { userId, sessionId } = context.params;
    const before = change.before.data();
    const after = change.after.data();

    // Only fire when state transitions to "complete"
    if (before.state === "complete" || after.state !== "complete") {
      return;
    }

    try {
      // Get program ID from session
      const programId = after.programId as string | undefined;
      if (!programId) {
        functions.logger.debug(`Session ${sessionId}: no programId, skipping BIT gate`);
        return;
      }

      // Skip non-Grid program sessions
      if (!GRID_PROGRAMS.includes(programId)) {
        functions.logger.debug(`Session ${sessionId}: ${programId} not a Grid program, skipping BIT gate`);
        return;
      }

      // Get session creation timestamp
      const sessionCreatedAt = after.createdAt;
      if (!sessionCreatedAt) {
        functions.logger.warn(`Session ${sessionId}: no createdAt timestamp, cannot enforce pattern extraction`);
        return; // Fail open
      }

      const sessionStartTime = getTimestampMillis(sessionCreatedAt);

      // Look up program state
      const programStateRef = db.doc(`tenants/${userId}/sessions/_meta/program_state/${programId}`);
      const programStateDoc = await programStateRef.get();

      if (!programStateDoc.exists) {
        // First session ever for this program — still require pattern extraction
        functions.logger.info(`Session ${sessionId}: ${programId} has no program state yet, enforcing pattern extraction for first session`);
        await blockDerez(userId, programId, sessionId, change.after.ref, 0);
        return;
      }

      const programState = programStateDoc.data();
      if (!programState) {
        functions.logger.warn(`Session ${sessionId}: program state document exists but has no data`);
        return; // Fail open
      }

      // Get learnedPatterns and lastUpdatedAt
      const learnedPatterns = (programState.learnedPatterns || []) as unknown[];
      const lastUpdatedAt = programState.lastUpdatedAt;

      if (!lastUpdatedAt) {
        // Program state exists but never updated — enforce extraction
        functions.logger.info(`Session ${sessionId}: ${programId} program state never updated, enforcing pattern extraction`);
        await blockDerez(userId, programId, sessionId, change.after.ref, 0);
        return;
      }

      const stateUpdateTime = getTimestampMillis(lastUpdatedAt);

      // Check if patterns were extracted during this session
      const stateUpdatedDuringSession = stateUpdateTime > sessionStartTime;
      const hasPatternsExtracted = learnedPatterns.length > 0;

      if (!stateUpdatedDuringSession || !hasPatternsExtracted) {
        // Pattern extraction check FAILED
        functions.logger.warn(
          `BIT gate: blocked derez for ${programId} — ` +
          `stateUpdated=${stateUpdatedDuringSession}, patternsCount=${learnedPatterns.length}`
        );
        await blockDerez(userId, programId, sessionId, change.after.ref, learnedPatterns.length);
      } else {
        // Pattern extraction check PASSED
        functions.logger.info(
          `BIT gate: derez approved for ${programId} — ${learnedPatterns.length} patterns extracted`
        );
      }
    } catch (error) {
      // Fail open — log error but don't block derez
      functions.logger.error(`BIT gate error for session ${sessionId}, failing open:`, error);
    }
  });

/**
 * Block derez by reverting session state and sending DIRECTIVE to program.
 */
async function blockDerez(
  userId: string,
  programId: string,
  sessionId: string,
  sessionRef: FirebaseFirestore.DocumentReference,
  currentPatternCount: number
): Promise<void> {
  // Create DIRECTIVE task
  const taskData = {
    type: "task",
    title: `[bit→${programId}] DIRECTIVE`,
    instructions:
      `DEREZ GATE: Pattern extraction required before derez. Your session is completing but ` +
      `learnedPatterns was not updated (current count: ${currentPatternCount}). Run the extraction ` +
      `protocol from grid/workflows/derez-pattern-extraction.md before completing your session. ` +
      `Call update_program_state() with at least one learnedPattern entry, then retry derez.`,
    target: programId,
    source: "bit",
    action: "interrupt",
    priority: "high",
    status: "created",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection(`tenants/${userId}/tasks`).add(taskData);

  // Revert session state to working
  await sessionRef.update({
    state: "working",
    status: "BLOCKED: Pattern extraction required before derez",
  });

  functions.logger.info(`BIT gate: sent DIRECTIVE to ${programId}, reverted session ${sessionId} to working`);
}

/**
 * Extract milliseconds from Firestore Timestamp or ISO string.
 */
function getTimestampMillis(timestamp: unknown): number {
  if (timestamp && typeof timestamp === "object" && "toMillis" in timestamp) {
    // Firestore Timestamp
    return (timestamp as admin.firestore.Timestamp).toMillis();
  }
  if (typeof timestamp === "string") {
    // ISO 8601 string
    return new Date(timestamp).getTime();
  }
  throw new Error(`Invalid timestamp type: ${typeof timestamp}`);
}
