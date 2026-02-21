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
exports.onSessionUpdate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const messaging = admin.messaging();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_UPDATES_PER_WINDOW = 20;
/**
 * Triggered when a session is updated.
 * Sends push notification for meaningful state changes.
 * Updated for v2 lifecycle statuses.
 */
exports.onSessionUpdate = functions.firestore
    .document("users/{userId}/sessions/{sessionId}")
    .onUpdate(async (change, context) => {
    const { userId, sessionId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    if (before.state === after.state && before.status === after.status)
        return;
    if (after.archived)
        return;
    try {
        // Check notification preferences
        const userDoc = await db.doc(`users/${userId}`).get();
        const prefs = userDoc.data()?.notificationPreferences;
        if (prefs?.sessionUpdates === false)
            return;
        // Rate limit
        const now = Date.now();
        const rateLimitRef = db.doc(`users/${userId}/rateLimits/sessionUpdates`);
        const rateLimitDoc = await rateLimitRef.get();
        const rateLimitData = rateLimitDoc.data();
        if (rateLimitData) {
            const windowStart = rateLimitData.windowStart?.toMillis() || 0;
            const count = rateLimitData.count || 0;
            if (now - windowStart < RATE_LIMIT_WINDOW_MS && count >= MAX_UPDATES_PER_WINDOW) {
                functions.logger.warn(`Rate limit exceeded for session updates: user ${userId}`);
                return;
            }
            if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
                await rateLimitRef.set({ windowStart: admin.firestore.Timestamp.now(), count: 1 });
            }
            else {
                await rateLimitRef.update({ count: admin.firestore.FieldValue.increment(1) });
            }
        }
        else {
            await rateLimitRef.set({ windowStart: admin.firestore.Timestamp.now(), count: 1 });
        }
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
        const sessionName = after.name || "Session";
        const statusText = sanitize(after.status || "Status updated", 50);
        let title;
        let body;
        // Map v2 lifecycle states to notification content
        switch (after.state) {
            case "complete":
            case "done":
                title = `${sessionName} Complete`;
                body = statusText;
                break;
            case "blocked":
                title = `${sessionName} Blocked`;
                body = statusText;
                break;
            case "pinned":
                title = `${sessionName} Paused`;
                body = "Waiting for your response";
                break;
            default:
                title = sessionName;
                body = statusText;
        }
        const notification = { title, body };
        const response = await messaging.sendEachForMulticast({
            tokens,
            notification,
            android: {
                priority: "normal",
                notification: { channelId: "sessions", priority: "default" },
            },
            apns: {
                payload: { aps: { alert: notification, sound: "default" } },
                headers: { "apns-priority": "5" },
            },
            data: { type: "session_update", sessionId, state: after.state || "working" },
        });
        functions.logger.info(`Session ${sessionId} update: ${response.successCount} sent, ${response.failureCount} failed`);
        // Clean up invalid tokens
        const tokensToRemove = [];
        response.responses.forEach((result, index) => {
            if (!result.success) {
                const code = result.error?.code;
                if (code === "messaging/invalid-registration-token" ||
                    code === "messaging/registration-token-not-registered") {
                    tokensToRemove.push(tokens[index]);
                }
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
    catch (error) {
        functions.logger.error(`Failed session notification for ${sessionId}`, error);
        throw error;
    }
});
function sanitize(text, maxLength) {
    const sanitized = text.replace(/[<>]/g, "").replace(/[\r\n]+/g, " ").trim();
    if (sanitized.length <= maxLength)
        return sanitized;
    return sanitized.substring(0, maxLength - 3) + "...";
}
//# sourceMappingURL=onSessionUpdate.js.map