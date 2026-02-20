/**
 * Sprint Module — Sprint lifecycle management.
 * Sprints are tasks with type: "sprint", stories are type: "sprint-story"
 * All in users/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../auth/apiKeyValidator.js";
import { z } from "zod";
import { syncSprintCreated, syncSprintCompleted } from "./github-sync.js";

const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  wave: z.number().optional(),
  dependencies: z.array(z.string()).optional(),
  complexity: z.enum(["normal", "high"]).optional(),
});

const CreateSprintSchema = z.object({
  projectName: z.string().max(100),
  branch: z.string().max(100),
  stories: z.array(StorySchema),
  sessionId: z.string().optional(),
  config: z.object({
    orchestratorModel: z.string().optional(),
    subagentModel: z.string().optional(),
    maxConcurrent: z.number().optional(),
  }).optional(),
});

const UpdateStorySchema = z.object({
  sprintId: z.string(),
  storyId: z.string(),
  status: z.enum(["queued", "active", "complete", "failed", "skipped"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  currentAction: z.string().max(200).optional(),
  model: z.string().optional(),
});

const AddStorySchema = z.object({
  sprintId: z.string(),
  story: StorySchema,
  insertionMode: z.enum(["current_wave", "next_wave", "backlog"]).default("next_wave"),
});

const CompleteSprintSchema = z.object({
  sprintId: z.string(),
  summary: z.object({
    completed: z.number().optional(),
    failed: z.number().optional(),
    skipped: z.number().optional(),
    duration: z.number().optional(),
  }).optional(),
});

type ToolResult = { content: Array<{ type: string; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Map sprint story status to lifecycle */
function storyStatusToLifecycle(status: string): string {
  switch (status) {
    case "queued": return "created";
    case "active": return "active";
    case "complete": return "done";
    case "failed": return "failed";
    case "skipped": return "derezzed";
    default: return "created";
  }
}

export async function createSprintHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CreateSprintSchema.parse(rawArgs);
  const db = getFirestore();
  const now = serverTimestamp();

  // Create parent sprint task
  const sprintData: Record<string, unknown> = {
    type: "sprint",
    title: `Sprint: ${args.projectName}`,
    instructions: "",
    source: "orchestrator",
    target: null,
    priority: "high",
    action: "sprint",
    status: "active",
    sprint: {
      projectName: args.projectName,
      branch: args.branch,
      config: args.config || null,
    },
    sessionId: args.sessionId || null,
    createdAt: now,
    startedAt: now,
    encrypted: false,
    archived: false,
  };

  const sprintRef = await db.collection(`users/${auth.userId}/tasks`).add(sprintData);
  const sprintId = sprintRef.id;

  // Create child sprint-story tasks
  const batch = db.batch();
  for (const story of args.stories) {
    const storyRef = db.collection(`users/${auth.userId}/tasks`).doc();
    batch.set(storyRef, {
      type: "sprint-story",
      title: story.title,
      instructions: "",
      source: "orchestrator",
      target: null,
      priority: "normal",
      action: "sprint",
      status: "created",
      sprint: {
        parentId: sprintId,
        projectName: args.projectName,
        branch: args.branch,
        wave: story.wave || 1,
        dependencies: story.dependencies || [],
        complexity: story.complexity || "normal",
      },
      createdAt: now,
      encrypted: false,
      archived: false,
    });
  }
  await batch.commit();

  // Fire-and-forget: sync sprint to GitHub Milestone + Issues
  syncSprintCreated(auth.userId, sprintId, args.projectName, args.stories);

  return jsonResult({
    success: true,
    sprintId,
    storiesCreated: args.stories.length,
    message: `Sprint created with ${args.stories.length} stories`,
  });
}

export async function updateStoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = UpdateStorySchema.parse(rawArgs);
  const db = getFirestore();

  // Find the story by looking for sprint-story tasks with matching sprint.parentId
  const snapshot = await db
    .collection(`users/${auth.userId}/tasks`)
    .where("type", "==", "sprint-story")
    .where("sprint.parentId", "==", args.sprintId)
    .get();

  // Find the specific story by storyId (stored in a field or matched by doc ID)
  const storyDoc = snapshot.docs.find((doc) => {
    const data = doc.data();
    return doc.id === args.storyId || data.title?.includes(args.storyId);
  });

  if (!storyDoc) {
    return jsonResult({ success: false, error: "Story not found" });
  }

  const updateData: Record<string, unknown> = {};

  if (args.status) {
    updateData.status = storyStatusToLifecycle(args.status);
    if (args.status === "active") updateData.startedAt = serverTimestamp();
    if (args.status === "complete" || args.status === "failed" || args.status === "skipped") {
      updateData.completedAt = serverTimestamp();
    }
  }
  if (args.progress !== undefined) updateData["sprint.currentAction"] = args.currentAction || null;
  if (args.currentAction) updateData["sprint.currentAction"] = args.currentAction;
  if (args.model) updateData.model = args.model;

  await storyDoc.ref.update(updateData);

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    storyId: args.storyId,
    message: "Story updated",
  });
}

export async function addStoryHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = AddStorySchema.parse(rawArgs);
  const db = getFirestore();

  const storyRef = db.collection(`users/${auth.userId}/tasks`).doc();

  // Determine wave based on insertion mode
  let wave = 1;
  if (args.insertionMode === "backlog") wave = 999;

  await storyRef.set({
    type: "sprint-story",
    title: args.story.title,
    instructions: "",
    source: "orchestrator",
    target: null,
    priority: "normal",
    action: "sprint",
    status: "created",
    sprint: {
      parentId: args.sprintId,
      wave,
      dependencies: args.story.dependencies || [],
      complexity: args.story.complexity || "normal",
    },
    createdAt: serverTimestamp(),
    encrypted: false,
    archived: false,
    addedDynamically: true,
  });

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    storyId: storyRef.id,
    wave,
    message: `Story added to sprint (wave ${wave})`,
  });
}

export async function completeSprintHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CompleteSprintSchema.parse(rawArgs);
  const db = getFirestore();
  const sprintRef = db.doc(`users/${auth.userId}/tasks/${args.sprintId}`);

  // Auto-calculate summary if not provided
  let summary = args.summary;
  if (!summary) {
    const stories = await db
      .collection(`users/${auth.userId}/tasks`)
      .where("type", "==", "sprint-story")
      .where("sprint.parentId", "==", args.sprintId)
      .get();

    let completed = 0, failed = 0, skipped = 0;
    for (const doc of stories.docs) {
      const s = doc.data().status;
      if (s === "done") completed++;
      else if (s === "failed") failed++;
      else if (s === "derezzed") skipped++;
    }
    summary = { completed, failed, skipped };
  }

  await sprintRef.update({
    status: "done",
    completedAt: serverTimestamp(),
    "sprint.summary": summary,
  });

  // Fire-and-forget: close GitHub Milestone
  syncSprintCompleted(auth.userId, args.sprintId);

  return jsonResult({
    success: true,
    sprintId: args.sprintId,
    summary,
    message: "Sprint completed",
  });
}
