import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Triggered when a task is updated.
 * Handles:
 * - Dream terminal transitions (completed, failed, killed → push notification)
 * - Sprint story cascades (update parent sprint progress)
 * - Lifecycle transition notifications (status changes)
 */
export const onTaskUpdate = functions.firestore
  .document("users/{userId}/tasks/{taskId}")
  .onUpdate(async (change, context) => {
    const { userId, taskId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    const taskType: string = after.type || "task";

    // Handle budget warnings for active dreams (even without status change)
    if (taskType === "dream" && after.status === "active") {
      await handleDreamBudgetWarning(userId, taskId, before, after);
    }

    // Skip if no status change
    if (before.status === after.status) return;

    if (taskType === "dream") {
      await handleDreamTransition(userId, taskId, before, after);
    } else if (taskType === "sprint-story") {
      await handleSprintStoryCascade(userId, taskId, after);
    }
  });

/**
 * Dream budget warning check for active dreams.
 */
async function handleDreamBudgetWarning(
  userId: string,
  taskId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const budgetCap = after.dream?.budget_cap_usd;
  const budgetConsumed = after.dream?.budget_consumed_usd || 0;
  const prevConsumed = before.dream?.budget_consumed_usd || 0;

  if (!budgetCap || budgetCap <= 0) return;

  const pct = (budgetConsumed / budgetCap) * 100;
  const prevPct = (prevConsumed / budgetCap) * 100;

  const thresholds = [50, 80, 95];
  for (const threshold of thresholds) {
    if (pct >= threshold && prevPct < threshold) {
      await sendBudgetWarning(userId, taskId, after, threshold, budgetConsumed, budgetCap);
      break;
    }
  }
}

/**
 * Send budget warning push notification.
 */
async function sendBudgetWarning(
  userId: string,
  taskId: string,
  dreamData: FirebaseFirestore.DocumentData,
  threshold: number,
  budgetConsumed: number,
  budgetCap: number
): Promise<void> {
  try {
    const devicesSnapshot = await db.collection(`users/${userId}/devices`).get();
    if (devicesSnapshot.empty) return;

    const tokens: string[] = [];
    devicesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.fcmToken) tokens.push(data.fcmToken);
    });
    if (tokens.length === 0) return;

    const agent = dreamData.dream?.agent || dreamData.source || "Agent";
    const title = `Dream Budget: ${threshold}% Used`;
    const body = `${agent} has consumed $${budgetConsumed.toFixed(2)} of $${budgetCap.toFixed(2)} budget (${Math.round((budgetConsumed / budgetCap) * 100)}%)`;

    const notification: admin.messaging.Notification = { title, body };

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification,
      android: {
        priority: "high",
        notification: { channelId: "dreams", priority: "high" },
      },
      apns: {
        payload: { aps: { alert: notification, sound: "default" } },
        headers: { "apns-priority": "10" },
      },
      data: {
        type: "dream_budget_warning",
        taskId,
        threshold: String(threshold),
        budgetConsumed: String(budgetConsumed),
        budgetCap: String(budgetCap),
      },
    });

    functions.logger.info(
      `Dream ${taskId} budget warning (${threshold}%): ${response.successCount} sent, ${response.failureCount} failed`
    );

    await cleanupInvalidTokens(db, userId, devicesSnapshot, tokens, response);
  } catch (error) {
    functions.logger.error(`Failed budget warning for ${taskId}`, error);
  }
}

/**
 * Dream terminal transitions → push notification with full morning report.
 */
async function handleDreamTransition(
  userId: string,
  taskId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const terminalStatuses = ["done", "failed", "derezzed"];
  if (!terminalStatuses.includes(after.status)) return;

  try {
    const devicesSnapshot = await db.collection(`users/${userId}/devices`).get();
    if (devicesSnapshot.empty) return;

    const tokens: string[] = [];
    devicesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.fcmToken) tokens.push(data.fcmToken);
    });
    if (tokens.length === 0) return;

    const agent = after.dream?.agent || after.source || "Agent";
    const budgetConsumed = after.dream?.budget_consumed_usd || 0;
    const budgetCap = after.dream?.budget_cap_usd || 0;
    const startedAt = after.startedAt?.toDate?.();
    const completedAt = after.completedAt?.toDate?.();
    const duration = startedAt && completedAt
      ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000 / 60)
      : null;

    let title: string;
    let body: string;

    switch (after.status) {
      case "done": {
        title = "Dream Complete";
        const outcome = after.dream?.outcome || "Check the morning report for details.";
        const prUrl = after.dream?.pr_url;
        const budgetInfo = budgetCap > 0
          ? `Budget: $${budgetConsumed.toFixed(2)} / $${budgetCap.toFixed(2)}`
          : `Cost: $${budgetConsumed.toFixed(2)}`;
        const durationInfo = duration ? ` • ${duration} min` : "";
        const prInfo = prUrl ? ` • PR ready` : "";
        body = `${agent}: ${outcome}\n${budgetInfo}${durationInfo}${prInfo}`;
        break;
      }
      case "failed": {
        title = "Dream Failed";
        const errorMsg = after.dream?.outcome || "Check logs for details.";
        const budgetInfo = budgetCap > 0
          ? ` Budget: $${budgetConsumed.toFixed(2)} / $${budgetCap.toFixed(2)}`
          : ` Cost: $${budgetConsumed.toFixed(2)}`;
        body = `${agent}: ${errorMsg}\n${budgetInfo}`;
        break;
      }
      case "derezzed": {
        title = "Dream Stopped";
        const budgetInfo = budgetCap > 0
          ? ` Budget: $${budgetConsumed.toFixed(2)} / $${budgetCap.toFixed(2)}`
          : ` Cost: $${budgetConsumed.toFixed(2)}`;
        body = `${agent} was stopped.${budgetInfo}`;
        break;
      }
      default:
        return;
    }

    const notification: admin.messaging.Notification = { title, body };

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification,
      android: {
        priority: "high",
        notification: { channelId: "dreams", priority: "high" },
      },
      apns: {
        payload: { aps: { alert: notification, sound: "default" } },
        headers: { "apns-priority": "10" },
      },
      data: {
        type: "dream_update",
        taskId,
        status: after.status,
        agent,
        budgetConsumed: String(budgetConsumed),
        budgetCap: String(budgetCap),
        duration: duration ? String(duration) : "",
        prUrl: after.dream?.pr_url || "",
      },
    });

    functions.logger.info(
      `Dream ${taskId} → ${after.status}: ${response.successCount} sent, ${response.failureCount} failed`
    );

    await cleanupInvalidTokens(db, userId, devicesSnapshot, tokens, response);
  } catch (error) {
    functions.logger.error(`Failed dream notification for ${taskId}`, error);
  }
}

/**
 * Sprint story update → cascade to parent sprint task.
 * Updates parent sprint progress based on all child stories.
 */
async function handleSprintStoryCascade(
  userId: string,
  storyId: string,
  storyData: FirebaseFirestore.DocumentData
): Promise<void> {
  const parentId = storyData.sprint?.parentId;
  if (!parentId) {
    functions.logger.warn(`Sprint story ${storyId} has no parentId`);
    return;
  }

  try {
    // Get all stories for this sprint
    const storiesSnapshot = await db
      .collection(`users/${userId}/tasks`)
      .where("type", "==", "sprint-story")
      .where("sprint.parentId", "==", parentId)
      .get();

    if (storiesSnapshot.empty) return;

    const stories = storiesSnapshot.docs.map((doc) => doc.data());

    const activeStories = stories.filter((s) => s.status === "active");
    const completedStories = stories.filter((s) =>
      ["done", "failed", "derezzed"].includes(s.status)
    );

    let sprintStatus: string;
    let sprintProgress: number;

    if (completedStories.length === stories.length) {
      const failedCount = stories.filter((s) => s.status === "failed").length;
      const skippedCount = stories.filter((s) => s.status === "derezzed").length;
      if (failedCount > 0) {
        sprintStatus = `Complete (${failedCount} failed)`;
      } else if (skippedCount > 0) {
        sprintStatus = `Complete (${skippedCount} skipped)`;
      } else {
        sprintStatus = "All stories complete";
      }
    } else if (activeStories.length > 0) {
      const activeIds = activeStories.map((s) => s.sprint?.storyId || s.title).join(", ");
      const currentAction = activeStories[0]?.sprint?.currentAction;
      sprintStatus = currentAction ? `${activeIds}: ${currentAction}` : `Working on ${activeIds}`;
    } else {
      sprintStatus = `${completedStories.length}/${stories.length} complete`;
    }

    const totalProgress = stories.reduce((sum, s) => sum + (s.sprint?.progress || 0), 0);
    sprintProgress = Math.round(totalProgress / stories.length);

    // Update parent sprint task
    const update: Record<string, unknown> = {
      "sprint.status": sprintStatus.substring(0, 200),
      "sprint.progress": sprintProgress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // If all stories complete, mark sprint as completing
    if (completedStories.length === stories.length) {
      update.status = "completing";
    }

    await db.doc(`users/${userId}/tasks/${parentId}`).update(update);

    functions.logger.info(
      `Sprint ${parentId} cascade: ${sprintStatus} (${sprintProgress}%)`
    );
  } catch (error) {
    // Non-fatal — log but don't throw
    functions.logger.error(`Failed sprint cascade for story ${storyId}`, error);
  }
}

async function cleanupInvalidTokens(
  db: FirebaseFirestore.Firestore,
  userId: string,
  devicesSnapshot: FirebaseFirestore.QuerySnapshot,
  tokens: string[],
  response: admin.messaging.BatchResponse
): Promise<void> {
  const invalidCodes = [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ];
  const tokensToRemove: string[] = [];
  response.responses.forEach((result, index) => {
    if (!result.success && result.error?.code && invalidCodes.includes(result.error.code)) {
      tokensToRemove.push(tokens[index]);
    }
  });
  if (tokensToRemove.length > 0) {
    const batch = db.batch();
    devicesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (tokensToRemove.includes(data.fcmToken)) batch.delete(doc.ref);
    });
    await batch.commit();
    functions.logger.info(`Removed ${tokensToRemove.length} invalid tokens`);
  }
}
