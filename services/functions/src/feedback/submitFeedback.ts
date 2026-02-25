import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { createGithubIssue, githubPat } from "./githubIssueCreator";

const db = admin.firestore();

export const submitFeedback = functions
  .runWith({ secrets: [githubPat] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }

    const userId = context.auth.uid;

    // Validate input
    const type = data.type;
    if (!["bug", "feature_request", "general"].includes(type)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        'type must be one of: bug, feature_request, general'
      );
    }

    const message = data.message;
    if (!message || typeof message !== "string") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "message is required"
      );
    }
    if (message.length < 1 || message.length > 2000) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "message must be between 1 and 2000 characters"
      );
    }

    const platform = data.platform || "ios";
    if (!["ios", "android", "cli"].includes(platform)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        'platform must be one of: ios, android, cli'
      );
    }

    // Rate limit: max 5 submissions per user per hour
    const oneHourAgo = admin.firestore.Timestamp.fromMillis(
      Date.now() - 60 * 60 * 1000
    );
    const recentSubmissions = await db
      .collection(`tenants/${userId}/feedback`)
      .where("createdAt", ">", oneHourAgo)
      .get();

    if (recentSubmissions.size >= 5) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Rate limit exceeded. Maximum 5 submissions per hour."
      );
    }

    // Hash the userId for GitHub issues (first 8 chars of SHA-256)
    const hashedUserId = crypto
      .createHash("sha256")
      .update(userId)
      .digest("hex")
      .substring(0, 8);

    // Write to Firestore
    const feedbackData = {
      type,
      message,
      screenshotUrl: data.screenshotUrl || null,
      appVersion: data.appVersion || "unknown",
      platform,
      osVersion: data.osVersion || "unknown",
      deviceModel: data.deviceModel || "unknown",
      githubIssueUrl: null,
      githubIssueNumber: null,
      status: "submitted",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const feedbackRef = await db
      .collection(`tenants/${userId}/feedback`)
      .add(feedbackData);

    // Try to create GitHub issue (fail-open: feedback persists even if GitHub fails)
    let issueUrl: string | null = null;
    let issueNumber: number | null = null;

    try {
      const result = await createGithubIssue({
        type,
        message,
        platform,
        appVersion: data.appVersion || "unknown",
        osVersion: data.osVersion || "unknown",
        deviceModel: data.deviceModel || "unknown",
        hashedUserId,
        screenshotUrl: data.screenshotUrl,
      });

      issueUrl = result.issueUrl;
      issueNumber = result.issueNumber;

      // Update feedback doc with GitHub issue info
      await feedbackRef.update({
        githubIssueUrl: issueUrl,
        githubIssueNumber: issueNumber,
        status: "issue_created",
      });
    } catch (error) {
      console.error("[Feedback] Failed to create GitHub issue:", error);
      // Leave status as 'submitted' - don't lose the feedback
    }

    return {
      success: true,
      feedbackId: feedbackRef.id,
      issueUrl,
      issueNumber,
    };
  });
