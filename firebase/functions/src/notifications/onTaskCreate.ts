import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();
const messaging = admin.messaging();

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const notificationCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const record = notificationCounts.get(userId);
  if (!record || now >= record.resetAt) {
    notificationCounts.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (record.count >= RATE_LIMIT_MAX) return true;
  record.count++;
  return false;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Triggered when a new task is created in the unified tasks collection.
 * Sends push notification for tasks directed at users (questions, alerts, dreams).
 * Replaces v1 onMessageCreate + onQuestionCreate.
 */
export const onTaskCreate = functions.firestore
  .document("users/{userId}/tasks/{taskId}")
  .onCreate(async (snapshot, context) => {
    const { userId, taskId } = context.params;
    const task = snapshot.data();
    const taskType: string = task.type || "task";

    // Only notify for types that need user attention
    const notifyTypes = ["question", "dream"];
    // Tasks targeted at programs don't need push notifications
    if (!notifyTypes.includes(taskType) && task.target && task.target !== "user") {
      functions.logger.info(`Skipping notification for ${taskType} task ${taskId} targeted at ${task.target}`);
      return;
    }

    // Questions always notify. Other types only if high priority or user-targeted.
    if (taskType === "task" && task.priority !== "high") {
      return;
    }

    if (isRateLimited(userId)) {
      functions.logger.warn(`Rate limit exceeded, skipping notification for task ${taskId}`);
      return;
    }

    try {
      const devicesSnapshot = await db.collection(`users/${userId}/devices`).get();
      if (devicesSnapshot.empty) {
        functions.logger.warn(`No devices registered for user ${userId}`);
        return;
      }

      const tokens: string[] = [];
      devicesSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.fcmToken) tokens.push(data.fcmToken);
      });
      if (tokens.length === 0) return;

      // Build notification content based on task type
      let title: string;
      let body: string;
      let channelId = "tasks";

      switch (taskType) {
        case "question":
          title = "Claude needs your input";
          body = truncate(task.preview || task.title || "New question", 100);
          channelId = "questions";
          break;
        case "dream":
          title = "Dream Session Started";
          body = truncate(task.title || "New dream session", 100);
          channelId = "dreams";
          break;
        default:
          title = "New Task";
          body = truncate(task.title || "Task created", 100);
          break;
      }

      const notification: admin.messaging.Notification = { title, body };
      const isHighPriority = task.priority === "high" || taskType === "question";

      const android: admin.messaging.AndroidConfig = {
        priority: isHighPriority ? "high" : "normal",
        notification: {
          channelId,
          priority: isHighPriority ? "max" : "default",
        },
      };

      // Badge count: pending questions
      const pendingCount = await db
        .collection(`users/${userId}/tasks`)
        .where("type", "==", "question")
        .where("status", "==", "created")
        .count()
        .get();

      const apns: admin.messaging.ApnsConfig = {
        payload: {
          aps: {
            alert: notification,
            sound: "default",
            badge: pendingCount.data().count,
          },
        },
        headers: {
          "apns-priority": isHighPriority ? "10" : "5",
        },
      };

      const data: Record<string, string> = {
        type: taskType,
        taskId,
        priority: task.priority || "normal",
      };

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification,
        android,
        apns,
        data,
      });

      functions.logger.info(
        `Task ${taskId} (${taskType}): ${response.successCount} sent, ${response.failureCount} failed`
      );

      // Clean up invalid tokens
      const invalidCodes = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
        "messaging/invalid-argument",
        "messaging/mismatched-credential",
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
          if (tokensToRemove.includes(data.fcmToken)) {
            batch.delete(doc.ref);
          }
        });
        await batch.commit();
        functions.logger.info(`Removed ${tokensToRemove.length} invalid tokens`);
      }
    } catch (error) {
      functions.logger.error(`Failed to send notification for task ${taskId}`, error);
      throw error;
    }
  });
