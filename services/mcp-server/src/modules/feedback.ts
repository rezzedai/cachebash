/**
 * Feedback Module — Submit feedback that creates GitHub Issues.
 * Collection: tenants/{uid}/feedback
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/authValidator.js";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import * as crypto from "crypto";

const SubmitFeedbackSchema = z.object({
  type: z.enum(["bug", "feature_request", "general"]).default("general"),
  message: z.string().min(1).max(2000),
  platform: z.enum(["ios", "android", "cli"]).default("cli"),
  appVersion: z.string().max(50).optional(),
  osVersion: z.string().max(50).optional(),
  deviceModel: z.string().max(100).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function createGithubIssue(input: {
  type: "bug" | "feature_request" | "general";
  message: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  deviceModel: string;
  hashedUserId: string;
  screenshotUrl?: string;
}): Promise<{ issueUrl: string; issueNumber: number }> {
  const githubToken = process.env.GITHUB_FEEDBACK_PAT;
  if (!githubToken) {
    throw new Error("GITHUB_FEEDBACK_PAT environment variable not set");
  }

  const octokit = new Octokit({ auth: githubToken });

  // Map type to labels
  const labelMap: Record<string, string[]> = {
    bug: ["bug", "user-feedback"],
    feature_request: ["feature-request", "user-feedback"],
    general: ["feedback", "user-feedback"],
  };

  // Build title: "type: first 80 chars of message"
  const typeLabel =
    input.type === "feature_request"
      ? "Feature Request"
      : input.type === "bug"
        ? "Bug Report"
        : "Feedback";
  const title = `${typeLabel}: ${input.message.substring(0, 80)}${
    input.message.length > 80 ? "..." : ""
  }`;

  // Build body using the template from the spec
  const screenshotSection = input.screenshotUrl
    ? `\n**Screenshot:** ${input.screenshotUrl}\n`
    : "";
  const body = `## ${typeLabel}

**Submitted via:** CacheBash ${input.platform} v${input.appVersion}
**Platform:** ${input.platform} ${input.osVersion}
**Device:** ${input.deviceModel}
**User:** ${input.hashedUserId}
${screenshotSection}
---

${input.message}

---

*This issue was created automatically from in-app feedback.*`;

  const response = await octokit.issues.create({
    owner: "rezzedai",
    repo: "cachebash",
    title,
    body,
    labels: labelMap[input.type] || ["feedback", "user-feedback"],
  });

  return {
    issueUrl: response.data.html_url,
    issueNumber: response.data.number,
  };
}

export async function submitFeedbackHandler(
  auth: AuthContext,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = SubmitFeedbackSchema.parse(rawArgs);
  const db = getFirestore();

  // Rate limit: max 5 submissions per user per hour
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(
    Date.now() - 60 * 60 * 1000
  );
  const recentSubmissions = await db
    .collection(`tenants/${auth.userId}/feedback`)
    .where("createdAt", ">", oneHourAgo)
    .get();

  if (recentSubmissions.size >= 5) {
    return jsonResult({
      success: false,
      error: "Rate limit exceeded. Maximum 5 submissions per hour.",
    });
  }

  // Hash the userId for GitHub issues (first 8 chars of SHA-256)
  const hashedUserId = crypto
    .createHash("sha256")
    .update(auth.userId)
    .digest("hex")
    .substring(0, 8);

  // Write to Firestore
  const feedbackData = {
    type: args.type,
    message: args.message,
    screenshotUrl: null,
    appVersion: args.appVersion || "unknown",
    platform: args.platform,
    osVersion: args.osVersion || "unknown",
    deviceModel: args.deviceModel || "unknown",
    githubIssueUrl: null,
    githubIssueNumber: null,
    status: "submitted",
    createdAt: serverTimestamp(),
  };

  const feedbackRef = await db
    .collection(`tenants/${auth.userId}/feedback`)
    .add(feedbackData);

  // Try to create GitHub issue (fail-open: feedback persists even if GitHub fails)
  let issueUrl: string | null = null;
  let issueNumber: number | null = null;

  try {
    const result = await createGithubIssue({
      type: args.type,
      message: args.message,
      platform: args.platform,
      appVersion: args.appVersion || "unknown",
      osVersion: args.osVersion || "unknown",
      deviceModel: args.deviceModel || "unknown",
      hashedUserId,
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

  return jsonResult({
    success: true,
    feedbackId: feedbackRef.id,
    issueUrl,
    issueNumber,
    message: issueUrl
      ? `Feedback submitted and GitHub issue created: ${issueUrl}`
      : "Feedback submitted (GitHub issue creation failed, but feedback was saved)",
  });
}
