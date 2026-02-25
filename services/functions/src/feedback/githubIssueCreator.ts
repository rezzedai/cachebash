import { Octokit } from "@octokit/rest";
import { defineSecret } from "firebase-functions/params";

const githubPat = defineSecret("GITHUB_FEEDBACK_PAT");

interface FeedbackIssueInput {
  type: "bug" | "feature_request" | "general";
  message: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  deviceModel: string;
  hashedUserId: string;
  screenshotUrl?: string;
}

interface FeedbackIssueResult {
  issueUrl: string;
  issueNumber: number;
}

export async function createGithubIssue(
  input: FeedbackIssueInput
): Promise<FeedbackIssueResult> {
  // Create Octokit instance with the secret
  const octokit = new Octokit({ auth: githubPat.value() });

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

// Export the secret so it can be referenced by Cloud Functions that use this utility
export { githubPat };
