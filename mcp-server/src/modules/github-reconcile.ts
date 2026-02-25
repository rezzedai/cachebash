/**
 * GitHub Reconciliation Module — Retry failed GitHub sync operations.
 * Processes queued sync failures with exponential backoff.
 */

import { Octokit } from "@octokit/rest";
import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { emitEvent } from "./events.js";

const MAX_RETRY_COUNT = 5;

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
  cachebash: "13f8350f",
  grid: "c06291cd",
  reach: "f61fd67f",
  drivehub: "405f0e3f",
  "cb.com": "9a213e62",
  optimeasure: "edb10355",
  arsenal: "9b538111",
  "grid-portal": "03da32ef",
  "client-work": "9a316f85",
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

// ── GraphQL helpers (duplicated from github-sync) ────────────────────────────

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

// ── Mapping helpers (duplicated from github-sync) ────────────────────────────

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

// ── Reconciliation Logic ─────────────────────────────────────────────────────

export async function reconcileGitHub(userId: string): Promise<{ processed: number; succeeded: number; abandoned: number }> {
  const db = getFirestore();
  const queueRef = db.collection(`tenants/${userId}/sync_queue`);
  
  // Query pending items with retryCount < MAX_RETRY_COUNT
  const snapshot = await queueRef
    .where("status", "==", "pending")
    .where("retryCount", "<", MAX_RETRY_COUNT)
    .orderBy("retryCount")
    .orderBy("timestamp")
    .limit(20)
    .get();
  
  let processed = 0;
  let succeeded = 0;
  let abandoned = 0;
  
  for (const doc of snapshot.docs) {
    const item = doc.data();
    processed++;
    
    try {
      // Re-execute the original sync operation
      await retrySync(userId, item.operation, item.payload);
      
      // Success — remove from queue
      await doc.ref.delete();
      succeeded++;
      
      emitEvent(userId, {
        event_type: "GITHUB_SYNC_RECONCILED",
        program_id: "gridbot",
        operation: item.operation,
      });
    } catch (error: any) {
      // Increment retry count
      const newRetryCount = (item.retryCount || 0) + 1;
      
      if (newRetryCount >= MAX_RETRY_COUNT) {
        // Mark as abandoned
        await doc.ref.update({
          status: "abandoned",
          retryCount: newRetryCount,
          lastAttempt: serverTimestamp(),
          lastError: error.message || String(error),
        });
        abandoned++;
        
        // Alert about abandoned item
        emitEvent(userId, {
          event_type: "GITHUB_SYNC_FAILED",
          program_id: "gridbot",
          operation: item.operation,
          error_class: "PERMANENT",
          abandoned: true,
        });
      } else {
        // Update retry count
        await doc.ref.update({
          retryCount: newRetryCount,
          lastAttempt: serverTimestamp(),
          lastError: error.message || String(error),
        });
      }
    }
  }
  
  return { processed, succeeded, abandoned };
}

async function retrySync(userId: string, operation: string, payload: any): Promise<void> {
  const ok = getOctokit();
  if (!ok) {
    throw new Error("GitHub token not configured");
  }

  const db = getFirestore();

  switch (operation) {
    case "syncTaskCreated": {
      const { taskId, taskData } = payload;
      const { title, instructions, action, priority, projectId, type } = taskData;
      
      const repo = mapRepo(projectId);
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
        repo,
        title,
        body: enrichedBody,
        labels,
      });

      const issueNumber = issue.data.number;
      const issueNodeId = issue.data.node_id;

      const projectItemId = await addItemToProject(ok, issueNodeId);
      if (!projectItemId) throw new Error("Failed to add item to project");

      await Promise.all([
        setProjectField(ok, projectItemId, FIELD_STATUS, STATUS_TODO),
        setProjectField(ok, projectItemId, FIELD_PRIORITY, mapPriority(priority || "medium", action)),
        setProjectField(ok, projectItemId, FIELD_PRODUCT, mapProduct(projectId)),
        setProjectField(ok, projectItemId, FIELD_KIND, mapKind(type || "task", action)),
      ]);

      await db.doc(`tenants/${userId}/tasks/${taskId}`).update({
        githubIssueNumber: issueNumber,
        githubProjectItemId: projectItemId,
      });
      
      console.log(`[GitHub Reconcile] Task ${taskId} → Issue #${issueNumber}`);
      break;
    }

    case "syncTaskClaimed": {
      const { taskId } = payload;
      const doc = await db.doc(`tenants/${userId}/tasks/${taskId}`).get();
      const data = doc.data();
      if (!data?.githubProjectItemId) {
        throw new Error("Task has no githubProjectItemId");
      }

      await setProjectField(ok, data.githubProjectItemId, FIELD_STATUS, STATUS_IN_PROGRESS);
      console.log(`[GitHub Reconcile] Task ${taskId} → InProgress`);
      break;
    }

    case "syncTaskCompleted": {
      const { taskId } = payload;
      const doc = await db.doc(`tenants/${userId}/tasks/${taskId}`).get();
      const data = doc.data();
      if (!data?.githubIssueNumber) {
        throw new Error("Task has no githubIssueNumber");
      }

      await ok.issues.update({
        owner: REPO_OWNER,
        repo: mapRepo(data.projectId),
        issue_number: data.githubIssueNumber,
        state: "closed",
      });

      if (data.githubProjectItemId) {
        await setProjectField(ok, data.githubProjectItemId, FIELD_STATUS, STATUS_DONE);
      }

      console.log(`[GitHub Reconcile] Task ${taskId} → Done (Issue #${data.githubIssueNumber} closed)`);
      break;
    }

    case "syncSprintCreated": {
      const { sprintId, sprintData } = payload;
      const { projectName, stories, projectId } = sprintData;
      
      const repo = mapRepo(projectId);

      const milestone = await ok.issues.createMilestone({
        owner: REPO_OWNER,
        repo,
        title: `Sprint: ${projectName}`,
      });

      const milestoneNumber = milestone.data.number;

      const sprintBody = `> **Sprint ID:** \`${sprintId}\` | **Project:** ${projectName}
> **Stories:** ${stories.length}
---
Sprint tracking issue for ${projectName}`;

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

      for (const story of stories) {
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

      await db.doc(`tenants/${userId}/tasks/${sprintId}`).update({
        githubMilestoneNumber: milestoneNumber,
        githubIssueNumber: sprintIssue.data.number,
        githubProjectItemId: sprintProjectItemId,
      });

      console.log(`[GitHub Reconcile] Sprint ${sprintId} → Issue #${sprintIssue.data.number} + Milestone #${milestoneNumber} (${stories.length} stories)`);
      break;
    }

    case "syncSprintCompleted": {
      const { sprintId } = payload;
      const doc = await db.doc(`tenants/${userId}/tasks/${sprintId}`).get();
      const data = doc.data();
      if (!data?.githubMilestoneNumber) {
        throw new Error("Sprint has no githubMilestoneNumber");
      }

      await ok.issues.updateMilestone({
        owner: REPO_OWNER,
        repo: mapRepo(data.sprint?.projectId),
        milestone_number: data.githubMilestoneNumber,
        state: "closed",
      });

      console.log(`[GitHub Reconcile] Sprint ${sprintId} → Milestone #${data.githubMilestoneNumber} closed`);
      break;
    }

    default:
      throw new Error(`Unknown sync operation: ${operation}`);
  }
}
