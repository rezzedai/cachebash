import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();
const messaging = admin.messaging();

const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const relayCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const record = relayCounts.get(userId);
  if (!record || now >= record.resetAt) {
    relayCounts.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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
export const onRelayCreate = functions.firestore
  .document("users/{userId}/relay/{relayId}")
  .onCreate(async (snapshot, context) => {
    const { userId, relayId } = context.params;
    const relay = snapshot.data();

    const messageType: string = relay.message_type || "";
    const source: string = relay.source || "";
    const target: string = relay.target || "";
    const priority: string = relay.priority || "normal";

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

      const tokens: string[] = [];
      devicesSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.fcmToken) tokens.push(data.fcmToken);
      });
      if (tokens.length === 0) return;

      // Build notification content
      const sourceUpper = source.toUpperCase();
      const targetUpper = target.toUpperCase();
      const payload: string = typeof relay.payload === "string"
        ? relay.payload
        : relay.message || "";

      let title: string;
      let channelId: string;

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

      const notification: admin.messaging.Notification = { title, body };

      const android: admin.messaging.AndroidConfig = {
        priority: isHighPriority ? "high" : "normal",
        notification: {
          channelId,
          priority: isHighPriority ? "max" : "default",
        },
      };

      const apns: admin.messaging.ApnsConfig = {
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

      const data: Record<string, string> = {
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

      functions.logger.info(
        `Relay ${relayId} (${messageType} ${source}→${target}): ${response.successCount} sent, ${response.failureCount} failed`
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
      functions.logger.error(`Failed to send push for relay ${relayId}`, error);
      throw error;
    }
  });
