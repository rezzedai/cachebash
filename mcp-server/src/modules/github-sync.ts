/**
 * GitHub Sync Module — Fire-and-forget sync to GitHub Issues + Project board.
 * All functions silently no-op when GITHUB_TOKEN is missing.
 * Errors are caught and logged, never thrown.
 */

import { Octokit } from "@octokit/rest";
import { getFirestore, serverTimestamp } from "../firebase/client.js";

// ── Project Board Constants ──────────────────────────────────────────────────

const REPO_OWNER = "rezzedai";
const REPO_NAME = "grid";

const PROJECT_ID = "PVT_kwDOD5cSAM4BPj-e";

const FIELD_STATUS = "PVTSSF_lADOD5cSAM4BPj-ezg973Ho";
const STATUS_TODO = "81956dd9";
const STATUS_IN_PROGRESS = "999f506f";
const STATUS_DONE = "f827f271";

const FIELD_PRIORITY = "PVTSSF_lADOD5cSAM4BPj-ezg973I8";
const PRIORITY_MAP: Record<string, string> = {
  p0: "6346dff7",
  p1: "015bc0a8",
  p2: "0d7a1a73",
  p3: "f9ddf006",
};

const FIELD_PRODUCT = "PVTSSF_lADOD5cSAM4BPj-ezg973JA";
const PRODUCT_MAP: Record<string, string> = {
  cachebash: "1f3a1721",
  grid: "6f9c9d45",
  reach: "ac2a6b94",
  drivehub: "c360cc97",
  "cb.com": "045c3d2e",
  optimeasure: "7c0dbeb8",
};

const FIELD_KIND = "PVTSSF_lADOD5cSAM4BPj-ezg974YI";
const KIND_FEATURE = "0ed46d80";
const KIND_BUG = "f5f9047c";
const KIND_CHORE = "589f98d6";
const KIND_IDEA = "e7b918c8";
const KIND_CONTENT = "4fa48c0e";

// ── Octokit init ─────────────────────────────────────────────────────────────

let octokit: Octokit | null = null;

function getOctokit(): Octokit | null {
  if (octokit) return octokit;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  octokit = new Octokit({ auth: token });
  return octokit;
}

// ── GraphQL helpers ──────────────────────────────────────────────────────────

async function addItemToProject(ok: Octokit, nodeId: string): Promise<string | null> {
  const result = await ok.graphql<{ addProjectV2Item: { item: { id: string } } }>(`
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2Item(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `, { projectId: PROJECT_ID, contentId: nodeId });
  return result.addProjectV2Item.item.id;
}

async function setProjectField(ok: Octokit, itemId: string, fieldId: string, optionId: string): Promise<void> {
  await ok.graphql(`
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value
      }) {
        projectV2Item { id }
      }
    }
  `, {
    projectId: PROJECT_ID,
    itemId: itemId,
    fieldId: fieldId,
    value: { singleSelectOptionId: optionId },
  });
}

// ── Priority / Product / Repo mapping ────────────────────────────────────────

function mapPriority(priority: string, action?: string): string {
  if (action === "interrupt") return PRIORITY_MAP.p0;
  switch (priority) {
    case "high": return PRIORITY_MAP.p1;
    case "low": return PRIORITY_MAP.p3;
    default: return PRIORITY_MAP.p2;
  }
}

function mapProduct(projectId?: string | null): string {
  if (!projectId) return PRODUCT_MAP.grid;
  const key = projectId.toLowerCase();
  return PRODUCT_MAP[key] || PRODUCT_MAP.grid;
}

function mapRepo(projectId?: string | null): string {
  if (!projectId) return REPO_NAME;
  const key = projectId.toLowerCase();
  if (key === "cachebash") return "cachebash";
  return REPO_NAME;
}

function mapKind(type: string, action?: string): string {
  if (action === "interrupt") return KIND_BUG;
  switch (type) {
    case "feature": return KIND_FEATURE;
    case "bug": return KIND_BUG;
    case "idea": return KIND_IDEA;
    case "content": return KIND_CONTENT;
    default: return KIND_CHORE;
  }
}

// ── Queue failed sync for retry ──────────────────────────────────────────────

/**
 * Queue a failed sync operation for retry.
 */
async function queueFailedSync(
  userId: string,
  operation: string,
  payload: Record<string, any>,
  error: string
): Promise<void> {
  try {
    const db = getFirestore();
    await db.collection(`tenants/${userId}/sync_queue`).add({
      operation,
      payload,
      error,
      timestamp: serverTimestamp(),
      retryCount: 0,
      status: "pending",
    });

    // Emit event
    const { emitEvent } = await import("./events.js");
    emitEvent(userId, {
      event_type: "GITHUB_SYNC_FAILED",
      program_id: "gridbot",
      operation,
      error_class: "TRANSIENT",
    });
  } catch (queueError) {
    console.error("[GitHub Sync] Failed to queue sync failure:", queueError);
  }
}

// ── Export: Sync Task Created ────────────────────────────────────────────────

export function syncTaskCreated(
  userId: string,
  taskId: string,
  title: string,
  instructions: string,
  action?: string,
  priority?: string,
  projectId?: string | null,
  type?: string
): void {
  const ok = getOctokit();
  if (!ok) return;

  (async () => {
    const repo = mapRepo(projectId);

    // Include program routing metadata
    const enrichedBody = `> **Task ID:** \`${taskId}\` | **Priority:** ${priority || "medium"} | **Action:** ${action || "queue"}
---
${instructions}`;

    const labels = [
      "grid-task",
      `priority:${priority || "medium"}`,
      `action:${action || "queue"}`,
    ];
    if (type) labels.push(`type:${type}`);

    const issue = await ok.issues.create({
      owner: REPO_OWNER,
      repo: mapRepo(projectId),
      title,
      body: enrichedBody,
      labels,
    });

    const issueNumber = issue.data.number;
    const issueNodeId = issue.data.node_id;

    // Add to project board
    const projectItemId = await addItemToProject(ok, issueNodeId);
    if (!projectItemId) return;

    // Set project fields
    await Promise.all([
      setProjectField(ok, projectItemId, FIELD_STATUS, STATUS_TODO),
      setProjectField(ok, projectItemId, FIELD_PRIORITY, mapPriority(priority || "medium", action)),
      setProjectField(ok, projectItemId, FIELD_PRODUCT, mapProduct(projectId)),
      setProjectField(ok, projectItemId, FIELD_KIND, mapKind(type || "task", action)),
    ]);

    // Store GitHub refs in Firestore task doc
    const db = getFirestore();
    await db.doc(`tenants/${userId}/tasks/${taskId}`).update({
      githubIssueNumber: issueNumber,
      githubProjectItemId: projectItemId,
    });

    console.log(`[GitHub Sync] Task ${taskId} → Issue #${issueNumber}`);
  })().catch((err) => {
    console.error("[GitHub Sync] syncTaskCreated failed:", err);
    queueFailedSync(userId, "syncTaskCreated", {
      taskId,
      taskData: { title, instructions, action, priority, projectId, type },
    }, err instanceof Error ? err.message : String(err));
  });
}

export function syncTaskClaimed(userId: string, taskId: string): void {
  const ok = getOctokit();
  if (!ok) return;

  (async () => {
    const db = getFirestore();
    const doc = await db.doc(`tenants/${userId}/tasks/${taskId}`).get();
    const data = doc.data();
    if (!data?.githubProjectItemId) return;

    await setProjectField(ok, data.githubProjectItemId, FIELD_STATUS, STATUS_IN_PROGRESS);
    console.log(`[GitHub Sync] Task ${taskId} → InProgress`);
  })().catch((err) => {
    console.error("[GitHub Sync] syncTaskClaimed failed:", err);
    queueFailedSync(userId, "syncTaskClaimed", { taskId }, err instanceof Error ? err.message : String(err));
  });
}

export function syncTaskCompleted(userId: string, taskId: string): void {
  const ok = getOctokit();
  if (!ok) return;

  (async () => {
    const db = getFirestore();
    const doc = await db.doc(`tenants/${userId}/tasks/${taskId}`).get();
    const data = doc.data();
    if (!data?.githubIssueNumber) return;

    // Close the issue
    await ok.issues.update({
      owner: REPO_OWNER,
      repo: mapRepo(data.projectId),
      issue_number: data.githubIssueNumber,
      state: "closed",
    });

    // Update project board status
    if (data.githubProjectItemId) {
      await setProjectField(ok, data.githubProjectItemId, FIELD_STATUS, STATUS_DONE);
    }

    console.log(`[GitHub Sync] Task ${taskId} → Done (Issue #${data.githubIssueNumber} closed)`);
  })().catch((err) => {
    console.error("[GitHub Sync] syncTaskCompleted failed:", err);
    queueFailedSync(userId, "syncTaskCompleted", { taskId }, err instanceof Error ? err.message : String(err));
  });
}

export function syncSprintCreated(
  userId: string,
  sprintId: string,
  projectName: string,
  stories: Array<{ id: string; title: string }>,
  projectId?: string | null
): void {
  const ok = getOctokit();
  if (!ok) return;

  (async () => {
    const repo = mapRepo(projectId);

    // Create milestone
    const milestone = await ok.issues.createMilestone({
      owner: REPO_OWNER,
      repo,
      title: `Sprint: ${projectName}`,
    });

    const milestoneNumber = milestone.data.number;

    // Build parent sprint issue body
    const sprintBody = `> **Sprint ID:** \`${sprintId}\` | **Project:** ${projectName}
> **Stories:** ${stories.length}
---
Sprint tracking issue for ${projectName}`;

    // Create parent sprint issue and add to board
    const sprintIssue = await ok.issues.create({
      owner: REPO_OWNER,
      repo,
      title: `[Sprint: ${projectName}]`,
      body: sprintBody,
      labels: ["grid-task", "sprint"],
      milestone: milestoneNumber,
    });

    const sprintIssueNodeId = sprintIssue.data.node_id;
    const sprintProjectItemId = await addItemToProject(ok, sprintIssueNodeId);
    if (sprintProjectItemId) {
      await Promise.all([
        setProjectField(ok, sprintProjectItemId, FIELD_STATUS, STATUS_IN_PROGRESS),
        setProjectField(ok, sprintProjectItemId, FIELD_KIND, KIND_CHORE),
        setProjectField(ok, sprintProjectItemId, FIELD_PRODUCT, mapProduct(projectId)),
        setProjectField(ok, sprintProjectItemId, FIELD_PRIORITY, PRIORITY_MAP.p1),
      ]);
    }

    // Create issue per story with milestone and add to board
    for (const story of stories) {
      // Build story body with sprint metadata
      const storyBody = `> **Sprint:** \`${sprintId}\` | **Story:** \`${story.id}\` | **Wave:** ${(story as any).wave || 1}
---
${story.title}`;

      const storyLabels = [
        "grid-task",
        "sprint-story",
        `sprint:${sprintId}`,
        `type:sprint-story`,
      ];

      const storyIssue = await ok.issues.create({
        owner: REPO_OWNER,
        repo,
        title: story.title,
        body: storyBody,
        labels: storyLabels,
        milestone: milestoneNumber,
      });

      const storyNodeId = storyIssue.data.node_id;
      const projectItemId = await addItemToProject(ok, storyNodeId);
      if (projectItemId) {
        await Promise.all([
          setProjectField(ok, projectItemId, FIELD_STATUS, STATUS_TODO),
          setProjectField(ok, projectItemId, FIELD_KIND, KIND_CHORE),
          setProjectField(ok, projectItemId, FIELD_PRODUCT, mapProduct(projectId)),
          setProjectField(ok, projectItemId, FIELD_PRIORITY, PRIORITY_MAP.p2),
        ]);
      }
    }

    // Store milestone + parent issue ref in sprint doc
    const db = getFirestore();
    await db.doc(`tenants/${userId}/tasks/${sprintId}`).update({
      githubMilestoneNumber: milestoneNumber,
      githubIssueNumber: sprintIssue.data.number,
      githubProjectItemId: sprintProjectItemId,
    });

    console.log(`[GitHub Sync] Sprint ${sprintId} → Issue #${sprintIssue.data.number} + Milestone #${milestoneNumber} (${stories.length} stories)`);
  })().catch((err) => {
    console.error("[GitHub Sync] syncSprintCreated failed:", err);
    queueFailedSync(userId, "syncSprintCreated", {
      sprintId,
      sprintData: { projectName, stories, projectId },
    }, err instanceof Error ? err.message : String(err));
  });
}

export function syncSprintCompleted(userId: string, sprintId: string): void {
  const ok = getOctokit();
  if (!ok) return;

  (async () => {
    const db = getFirestore();
    const doc = await db.doc(`tenants/${userId}/tasks/${sprintId}`).get();
    const data = doc.data();
    if (!data?.githubMilestoneNumber) return;

    await ok.issues.updateMilestone({
      owner: REPO_OWNER,
      repo: mapRepo(data.sprint?.projectId),
      milestone_number: data.githubMilestoneNumber,
      state: "closed",
    });

    console.log(`[GitHub Sync] Sprint ${sprintId} → Milestone #${data.githubMilestoneNumber} closed`);
  })().catch((err) => {
    console.error("[GitHub Sync] syncSprintCompleted failed:", err);
    queueFailedSync(userId, "syncSprintCompleted", { sprintId }, err instanceof Error ? err.message : String(err));
  });
}
