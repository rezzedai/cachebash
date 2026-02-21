"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTaskCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const messaging = admin.messaging();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const notificationCounts = new Map();
function isRateLimited(userId) {
    const now = Date.now();
    const record = notificationCounts.get(userId);
    if (!record || now >= record.resetAt) {
        notificationCounts.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    if (record.count >= RATE_LIMIT_MAX)
        return true;
    record.count++;
    return false;
}
function truncate(str, maxLength) {
    if (str.length <= maxLength)
        return str;
    return str.substring(0, maxLength - 3) + "...";
}
/**
 * Triggered when a new task is created in the unified tasks collection.
 * Sends push notification for tasks directed at users (questions, alerts, dreams).
 * Replaces v1 onMessageCreate + onQuestionCreate.
 */
exports.onTaskCreate = functions.firestore
    .document("users/{userId}/tasks/{taskId}")
    .onCreate(async (snapshot, context) => {
    const { userId, taskId } = context.params;
    const task = snapshot.data();
    const taskType = task.type || "task";
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
        const tokens = [];
        devicesSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.fcmToken)
                tokens.push(data.fcmToken);
        });
        if (tokens.length === 0)
            return;
        // Build notification content based on task type
        let title;
        let body;
        let channelId = "tasks";
        switch (taskType) {
            case "question":
                title = "Your agent needs input";
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
        const notification = { title, body };
        const isHighPriority = task.priority === "high" || taskType === "question";
        const android = {
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
        const apns = {
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
        const data = {
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
        functions.logger.info(`Task ${taskId} (${taskType}): ${response.successCount} sent, ${response.failureCount} failed`);
        // Clean up invalid tokens
        const invalidCodes = [
            "messaging/invalid-registration-token",
            "messaging/registration-token-not-registered",
            "messaging/invalid-argument",
            "messaging/mismatched-credential",
        ];
        const tokensToRemove = [];
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
    }
    catch (error) {
        functions.logger.error(`Failed to send notification for task ${taskId}`, error);
        throw error;
    }
});
//# sourceMappingURL=onTaskCreate.js.map