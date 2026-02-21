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
exports.onRelayCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const messaging = admin.messaging();
const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const relayCounts = new Map();
function isRateLimited(userId) {
    const now = Date.now();
    const record = relayCounts.get(userId);
    if (!record || now >= record.resetAt) {
        relayCounts.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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
// Message types that should never trigger push notifications
const SUPPRESSED_TYPES = ["PONG", "ACK", "HANDSHAKE"];
// Message types that always trigger push regardless of priority
const ALWAYS_NOTIFY_TYPES = ["DIRECTIVE", "QUERY"];
/**
 * Triggered when a new relay message is created.
 * Sends push notification for inter-program comms that need user awareness.
 * Covers the gap where program-to-program DIRECTIVEs (like BIT emergency alerts)
 * were silently written to Firestore with no push delivery.
 */
exports.onRelayCreate = functions.firestore
    .document("users/{userId}/relay/{relayId}")
    .onCreate(async (snapshot, context) => {
    const { userId, relayId } = context.params;
    const relay = snapshot.data();
    const messageType = relay.message_type || "";
    const source = relay.source || "";
    const target = relay.target || "";
    const priority = relay.priority || "normal";
    // Skip portal-originated messages (user sent it, they already know)
    if (source === "portal") {
        functions.logger.info(`Skipping push for portal-originated relay ${relayId}`);
        return;
    }
    // Skip suppressed message types (noise)
    if (SUPPRESSED_TYPES.includes(messageType)) {
        functions.logger.info(`Skipping push for suppressed type ${messageType} relay ${relayId}`);
        return;
    }
    // For non-always-notify types, only push if high priority
    if (!ALWAYS_NOTIFY_TYPES.includes(messageType) && priority !== "high") {
        functions.logger.info(`Skipping push for ${messageType} relay ${relayId} (priority: ${priority})`);
        return;
    }
    if (isRateLimited(userId)) {
        functions.logger.warn(`Rate limit exceeded, skipping push for relay ${relayId}`);
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
        // Build notification content
        const sourceUpper = source.toUpperCase();
        const targetUpper = target.toUpperCase();
        const payload = typeof relay.payload === "string"
            ? relay.payload
            : relay.message || "";
        let title;
        let channelId;
        switch (messageType) {
            case "DIRECTIVE":
                title = `${sourceUpper} → ${targetUpper}: Directive`;
                channelId = "operational";
                break;
            case "QUERY":
                title = `${sourceUpper} → ${targetUpper}: Query`;
                channelId = "operational";
                break;
            case "STATUS":
                title = `${sourceUpper}: Status Update`;
                channelId = "informational";
                break;
            case "RESULT":
                title = `${sourceUpper} → ${targetUpper}: Result`;
                channelId = "operational";
                break;
            case "PING":
                title = `${sourceUpper}: Ping`;
                channelId = "informational";
                break;
            default:
                title = `${sourceUpper} → ${targetUpper}: ${messageType}`;
                channelId = "informational";
                break;
        }
        const body = truncate(payload, 150);
        const isHighPriority = priority === "high" || ALWAYS_NOTIFY_TYPES.includes(messageType);
        const notification = { title, body };
        const android = {
            priority: isHighPriority ? "high" : "normal",
            notification: {
                channelId,
                priority: isHighPriority ? "max" : "default",
            },
        };
        const apns = {
            payload: {
                aps: {
                    alert: notification,
                    sound: isHighPriority ? "default" : undefined,
                },
            },
            headers: {
                "apns-priority": isHighPriority ? "10" : "5",
            },
        };
        const data = {
            type: "relay",
            relayId,
            messageType,
            source,
            target,
            priority,
        };
        const response = await messaging.sendEachForMulticast({
            tokens,
            notification,
            android,
            apns,
            data,
        });
        functions.logger.info(`Relay ${relayId} (${messageType} ${source}→${target}): ${response.successCount} sent, ${response.failureCount} failed`);
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
        functions.logger.error(`Failed to send push for relay ${relayId}`, error);
        throw error;
    }
});
//# sourceMappingURL=onRelayCreate.js.map