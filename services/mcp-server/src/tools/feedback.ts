/**
 * Feedback Domain Registry — User feedback submission tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { submitFeedbackHandler } from "../modules/feedback.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  feedback_submit_feedback: submitFeedbackHandler,
};

export const definitions = [
  {
    name: "feedback_submit_feedback",
    description: "Submit feedback (bug report, feature request, or general) which creates a GitHub Issue",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["bug", "feature_request", "general"], default: "general", description: "Feedback type" },
        message: { type: "string", maxLength: 2000, description: "Feedback message (required, 1-2000 chars)" },
        platform: { type: "string", enum: ["ios", "android", "cli"], default: "cli", description: "Submitting platform" },
        appVersion: { type: "string", description: "App version string", maxLength: 50 },
        osVersion: { type: "string", description: "OS version", maxLength: 50 },
        deviceModel: { type: "string", description: "Device model", maxLength: 100 },
      },
      required: ["message"],
    },
  },
];
