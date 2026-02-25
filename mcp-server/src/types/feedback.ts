import * as admin from "firebase-admin";

export type FeedbackType = "bug" | "feature_request" | "general";
export type FeedbackStatus = "submitted" | "issue_created" | "failed";
export type FeedbackPlatform = "ios" | "android" | "cli";

export interface FeedbackSubmission {
  id: string;
  type: FeedbackType;
  message: string;
  screenshotUrl: string | null;
  appVersion: string;
  platform: FeedbackPlatform;
  osVersion: string;
  deviceModel: string;
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
  status: FeedbackStatus;
  createdAt: admin.firestore.Timestamp;
}
