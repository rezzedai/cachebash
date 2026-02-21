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
exports.onTaskUpdate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const messaging = admin.messaging();
/**
 * Triggered when a task is updated.
 * Handles:
 * - Dream terminal transitions (completed, failed, killed → push notification)
 * - Sprint story cascades (update parent sprint progress)
 * - Lifecycle transition notifications (status changes)
 */
exports.onTaskUpdate = functions.firestore
    .document("users/{userId}/tasks/{taskId}")
    .onUpdate(async (change, context) => {
    const { userId, taskId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    const taskType = after.type || "task";
    // Skip if no status change
    if (before.status === after.status)
        return;
    if (taskType === "dream") {
        await handleDreamTransition(userId, taskId, before, after);
    }
    else if (taskType === "sprint-story") {
        await handleSprintStoryCascade(userId, taskId, after);
    }
});
/**
 * Dream terminal transitions → push notification.
 */
async function handleDreamTransition(userId, taskId, before, after) {
    const terminalStatuses = ["done", "failed", "derezzed"];
    if (!terminalStatuses.includes(after.status))
        return;
    try {
        const devicesSnapshot = await db.collection(`users/${userId}/devices`).get();
        if (devicesSnapshot.empty)
            return;
        const tokens = [];
        devicesSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.fcmToken)
                tokens.push(data.fcmToken);
        });
        if (tokens.length === 0)
            return;
        const agent = after.dream?.agent || after.source || "Agent";
        let title;
        let body;
        switch (after.status) {
            case "done": {
                title = "Dream Complete";
                const report = after.dream?.morningReport;
                const preview = report
                    ? report.substring(0, 100).replace(/[\r\n]+/g, " ")
                    : "Check the morning report for details.";
                body = `${agent}: ${preview}`;
                break;
            }
            case "failed":
                title = "Dream Failed";
                body = `${agent} encountered an error. ${after.dream?.outcome || "Check logs."}`;
                break;
            case "derezzed":
                title = "Dream Stopped";
                body = `${agent} was stopped.`;
                break;
            default:
                return;
        }
        const notification = { title, body };
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
            data: { type: "dream_update", taskId, status: after.status, agent },
        });
        functions.logger.info(`Dream ${taskId} → ${after.status}: ${response.successCount} sent, ${response.failureCount} failed`);
        await cleanupInvalidTokens(db, userId, devicesSnapshot, tokens, response);
    }
    catch (error) {
        functions.logger.error(`Failed dream notification for ${taskId}`, error);
    }
}
/**
 * Sprint story update → cascade to parent sprint task.
 * Updates parent sprint progress based on all child stories.
 */
async function handleSprintStoryCascade(userId, storyId, storyData) {
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
        if (storiesSnapshot.empty)
            return;
        const stories = storiesSnapshot.docs.map((doc) => doc.data());
        const activeStories = stories.filter((s) => s.status === "active");
        const completedStories = stories.filter((s) => ["done", "failed", "derezzed"].includes(s.status));
        let sprintStatus;
        let sprintProgress;
        if (completedStories.length === stories.length) {
            const failedCount = stories.filter((s) => s.status === "failed").length;
            const skippedCount = stories.filter((s) => s.status === "derezzed").length;
            if (failedCount > 0) {
                sprintStatus = `Complete (${failedCount} failed)`;
            }
            else if (skippedCount > 0) {
                sprintStatus = `Complete (${skippedCount} skipped)`;
            }
            else {
                sprintStatus = "All stories complete";
            }
        }
        else if (activeStories.length > 0) {
            const activeIds = activeStories.map((s) => s.sprint?.storyId || s.title).join(", ");
            const currentAction = activeStories[0]?.sprint?.currentAction;
            sprintStatus = currentAction ? `${activeIds}: ${currentAction}` : `Working on ${activeIds}`;
        }
        else {
            sprintStatus = `${completedStories.length}/${stories.length} complete`;
        }
        const totalProgress = stories.reduce((sum, s) => sum + (s.sprint?.progress || 0), 0);
        sprintProgress = Math.round(totalProgress / stories.length);
        // Update parent sprint task
        const update = {
            "sprint.status": sprintStatus.substring(0, 200),
            "sprint.progress": sprintProgress,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        // If all stories complete, mark sprint as completing
        if (completedStories.length === stories.length) {
            update.status = "completing";
        }
        await db.doc(`users/${userId}/tasks/${parentId}`).update(update);
        functions.logger.info(`Sprint ${parentId} cascade: ${sprintStatus} (${sprintProgress}%)`);
    }
    catch (error) {
        // Non-fatal — log but don't throw
        functions.logger.error(`Failed sprint cascade for story ${storyId}`, error);
    }
}
async function cleanupInvalidTokens(db, userId, devicesSnapshot, tokens, response) {
    const invalidCodes = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
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
            if (tokensToRemove.includes(data.fcmToken))
                batch.delete(doc.ref);
        });
        await batch.commit();
        functions.logger.info(`Removed ${tokensToRemove.length} invalid tokens`);
    }
}
//# sourceMappingURL=onTaskUpdate.js.map