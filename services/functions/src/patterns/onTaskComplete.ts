import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

interface Task {
  type?: string;
  title?: string;
  target?: string;
  source?: string;
  status?: string;
  completed_status?: string;
  completedAt?: admin.firestore.Timestamp;
  instructions?: string;
  [key: string]: any;
}

/**
 * Maps program names to domains for capability gap detection.
 */
function getDomain(programName: string): string {
  const domainMap: { [key: string]: string } = {
    // Dev
    basher: "dev",
    gem: "dev",
    rinzler: "dev",
    link: "dev",
    tron: "dev",
    // Arch
    alan: "arch",
    radia: "arch",
    // Security
    sark: "security",
    dumont: "security",
    // Content
    castor: "content",
    scribe: "content",
    sage: "content",
    // Product
    clu: "product",
    quorra: "product",
    casp: "product",
    // Ops
    iso: "ops",
    bit: "ops",
    byte: "ops",
    system: "ops",
    ram: "ops",
  };

  return domainMap[programName.toLowerCase()] || "unknown";
}

/**
 * Triggered when a task is updated.
 * Detects capability gaps when tasks repeatedly fail in the same domain.
 *
 * Logic:
 * 1. Only fires when completed_status changes to "FAILED"
 * 2. Determines the domain from the failed task's target field
 * 3. Queries recent failures in the same domain (last 30 days)
 * 4. If count >= 3, creates a gap-analysis task for ISO (with deduplication)
 */
export const onTaskCompleteFailed = functions.firestore
  .document("tenants/{userId}/tasks/{taskId}")
  .onUpdate(async (change, context) => {
    const { userId, taskId } = context.params;
    const before = change.before.data() as Task;
    const after = change.after.data() as Task;

    // Guard: only proceed if completed_status changed to FAILED
    if (before.completed_status === "FAILED") {
      // Already was FAILED before this update - don't re-process
      return;
    }

    if (after.completed_status !== "FAILED") {
      // Not a failure - skip
      return;
    }

    functions.logger.info(
      `Task ${taskId} failed. Checking for capability gap...`
    );

    // Determine domain from target field
    const programName = after.target || "unknown";
    const domain = getDomain(programName);

    functions.logger.info(
      `Task ${taskId} target: ${programName}, domain: ${domain}`
    );

    try {
      // Query recent failures in the same domain (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const failuresSnapshot = await db
        .collection(`tenants/${userId}/tasks`)
        .where("completed_status", "==", "FAILED")
        .where("completedAt", ">=", admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
        .get();

      if (failuresSnapshot.empty) {
        functions.logger.info(
          `No recent failures found for domain ${domain}. Skipping gap detection.`
        );
        return;
      }

      // Filter by domain
      const domainFailures = failuresSnapshot.docs.filter((doc) => {
        const data = doc.data() as Task;
        const taskDomain = getDomain(data.target || "unknown");
        return taskDomain === domain;
      });

      const failureCount = domainFailures.length;

      functions.logger.info(
        `Found ${failureCount} failures in domain ${domain} within 30 days`
      );

      if (failureCount < 3) {
        // Not enough failures to trigger gap detection
        return;
      }

      // Check for existing gap-analysis task (deduplication)
      const gapTaskTitle = `Capability gap detected: ${domain}`;
      const existingGapTaskSnapshot = await db
        .collection(`tenants/${userId}/tasks`)
        .where("title", "==", gapTaskTitle)
        .where("status", "!=", "completed")
        .get();

      if (!existingGapTaskSnapshot.empty) {
        functions.logger.info(
          `Gap-analysis task already exists for domain ${domain}. Skipping creation.`
        );
        return;
      }

      // Build failed tasks list
      const failedTasksList = domainFailures
        .map((doc) => {
          const data = doc.data() as Task;
          return `${doc.id} (${data.title || "untitled"})`;
        })
        .join(", ");

      // Build programs list
      const programsSet = new Set<string>();
      domainFailures.forEach((doc) => {
        const data = doc.data() as Task;
        if (data.target) {
          programsSet.add(data.target);
        }
      });
      const programsList = Array.from(programsSet).join(", ");

      // Create gap-analysis task
      const taskRef = db.collection(`tenants/${userId}/tasks`).doc();
      await taskRef.set({
        type: "task",
        title: gapTaskTitle,
        instructions: `3+ failures detected in domain '${domain}' within 30 days. Failed tasks: ${failedTasksList}. Programs involved: ${programsList}. Investigate root cause per grid/workflows/capability-gap-detection.md.`,
        target: "iso",
        source: "system",
        action: "queue",
        priority: "normal",
        status: "created",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      functions.logger.info(
        `Created gap-analysis task ${taskRef.id} for domain ${domain} (${failureCount} failures)`
      );
    } catch (error) {
      functions.logger.error(
        `Failed to process capability gap detection for task ${taskId}`,
        error
      );
      // Don't throw - this is a non-critical background task
    }
  });
