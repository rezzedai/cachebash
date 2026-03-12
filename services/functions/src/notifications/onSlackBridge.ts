import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const db = admin.firestore();

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const rateCounts = new Map<string, { count: number; resetAt: number }>();
const recentMessages = new Map<string, number>();

function isRateLimited(): boolean {
  const now = Date.now();
  const key = "global";
  const record = rateCounts.get(key);
  if (!record || now >= record.resetAt) {
    rateCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (record.count >= RATE_LIMIT_MAX) return true;
  record.count++;
  return false;
}

function isDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  const lastSeen = recentMessages.get(fingerprint);
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return true;
  recentMessages.set(fingerprint, now);
  // Cleanup old entries
  for (const [key, ts] of recentMessages) {
    if (now - ts > DEDUP_WINDOW_MS) recentMessages.delete(key);
  }
  return false;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string; emoji?: boolean }>;
  fields?: Array<{ type: string; text: string }>;
}

function formatBlocks(relay: FirebaseFirestore.DocumentData): SlackBlock[] {
  const source = (relay.source || "unknown").toUpperCase();
  const messageType: string = relay.message_type || "STATUS";
  const payload: string = typeof relay.payload === "string"
    ? relay.payload
    : relay.message || "";

  let emoji: string;
  let title: string;

  switch (messageType) {
    case "DIRECTIVE":
      emoji = ":zap:";
      title = `Directive from ${source}`;
      break;
    case "STATUS":
      emoji = ":large_blue_circle:";
      title = `${source} Status`;
      break;
    case "RESULT":
      emoji = ":white_check_mark:";
      title = `${source} Result`;
      break;
    case "QUERY":
      emoji = ":question:";
      title = `${source} Query`;
      break;
    default:
      emoji = ":robot_face:";
      title = `${source}: ${messageType}`;
      break;
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji}  [GRID] ${title}`, emoji: true },
    },
  ];

  if (payload) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncate(payload, 2900) },
    });
  }

  const fields: Array<{ type: string; text: string }> = [];
  if (relay.source) fields.push({ type: "mrkdwn", text: `*From:* ${relay.source}` });
  if (relay.target && relay.target !== "slack-bridge") {
    fields.push({ type: "mrkdwn", text: `*To:* ${relay.target}` });
  }
  if (relay.priority && relay.priority !== "normal") {
    fields.push({ type: "mrkdwn", text: `*Priority:* ${relay.priority}` });
  }
  if (relay.sessionId) {
    fields.push({ type: "mrkdwn", text: `*Session:* ${relay.sessionId}` });
  }

  if (fields.length > 0) {
    blocks.push({ type: "section", fields });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Grid Relay | ${new Date().toISOString()}` }],
  });

  return blocks;
}

async function postToSlack(channel: string, blocks: SlackBlock[], text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    functions.logger.error("SLACK_BOT_TOKEN not configured");
    return false;
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, blocks, text }),
      });

      const result = await response.json() as { ok: boolean; error?: string };
      if (result.ok) return true;

      functions.logger.warn(`Slack API error (attempt ${attempt + 1}): ${result.error}`);
      if (result.error === "channel_not_found" || result.error === "not_in_channel") return false;
    } catch (error) {
      functions.logger.warn(`Slack POST failed (attempt ${attempt + 1})`, error);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }

  return false;
}

/**
 * Triggered when a new relay message targets "slack-bridge".
 * Formats the message with Slack Block Kit and posts to #grid-ops.
 * Rate limited to 30 messages/hour. Deduplicates within 5-minute windows.
 */
export const onSlackBridge = functions.firestore
  .document("tenants/{userId}/relay/{relayId}")
  .onCreate(async (snapshot, context) => {
    const { userId, relayId } = context.params;
    const relay = snapshot.data();

    // Only process messages targeting slack-bridge
    if (relay.target !== "slack-bridge") return;

    const source: string = relay.source || "";
    const messageType: string = relay.message_type || "";
    const payload: string = typeof relay.payload === "string" ? relay.payload : relay.message || "";

    functions.logger.info(`Slack bridge: ${source} ${messageType} (relay ${relayId})`);

    // Deduplication: fingerprint = source + type + first 100 chars of payload
    const fingerprint = `${source}:${messageType}:${payload.substring(0, 100)}`;
    if (isDuplicate(fingerprint)) {
      functions.logger.info(`Skipping duplicate relay ${relayId}`);
      return;
    }

    // Rate limiting
    if (isRateLimited()) {
      functions.logger.warn(`Rate limit exceeded, skipping slack bridge for relay ${relayId}`);
      return;
    }

    const channel = process.env.SLACK_GRID_OPS_CHANNEL;
    if (!channel) {
      functions.logger.error("SLACK_GRID_OPS_CHANNEL not configured");
      return;
    }

    const blocks = formatBlocks(relay);
    const fallbackText = `[GRID] ${source.toUpperCase()}: ${truncate(payload, 150)}`;

    const success = await postToSlack(channel, blocks, fallbackText);

    // Mark as delivered or dead-lettered
    try {
      await db.doc(`tenants/${userId}/relay/${relayId}`).update({
        status: success ? "delivered" : "dead_lettered",
        ...(success
          ? { deliveredAt: admin.firestore.FieldValue.serverTimestamp() }
          : {
              deadLetteredAt: admin.firestore.FieldValue.serverTimestamp(),
              dead_letter_reason: "SLACK_DELIVERY_FAILED",
            }),
      });
    } catch (updateError) {
      functions.logger.error(`Failed to update relay ${relayId} status`, updateError);
    }
  });
