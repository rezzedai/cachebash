/**
 * Integration Test: Sprint Execution
 *
 * Tests sprint lifecycle against Firestore emulator:
 * - Create sprint
 * - Story status transitions
 * - Wave progression
 * - Sprint completion
 */

import * as admin from "firebase-admin";
import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";

describe("Sprint Execution Integration", () => {
  let db: admin.firestore.Firestore;
  let userId: string;

  beforeAll(() => {
    db = getTestFirestore();
  });

  beforeEach(async () => {
    await clearFirestoreData();
    const testUser = await seedTestUser("test-user-123");
    userId = testUser.userId;
  });

  describe("Create Sprint", () => {
    it("should create a sprint document with correct structure", async () => {
      const sprintId = "sprint-001";
      const sprintData = {
        projectName: "Test Project",
        branch: "feature/test",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          {
            id: "story-1",
            title: "Story 1",
            status: "queued",
            wave: 0,
            complexity: "normal",
          },
          {
            id: "story-2",
            title: "Story 2",
            status: "queued",
            wave: 1,
            complexity: "normal",
          },
        ],
        config: {
          maxConcurrent: 2,
          orchestratorModel: "claude-opus-4-6",
          subagentModel: "claude-sonnet-4-5",
        },
      };

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set(sprintData);

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const data = sprintDoc.data();

      expect(sprintDoc.exists).toBe(true);
      expect(data?.projectName).toBe("Test Project");
      expect(data?.branch).toBe("feature/test");
      expect(data?.status).toBe("active");
      expect(data?.currentWave).toBe(0);
      expect(data?.stories).toHaveLength(2);
    });

    it("should handle sprint with multiple waves", async () => {
      const sprintId = "sprint-002";
      const stories = [
        { id: "s1", title: "Wave 0 Story 1", wave: 0 },
        { id: "s2", title: "Wave 0 Story 2", wave: 0 },
        { id: "s3", title: "Wave 1 Story 1", wave: 1 },
        { id: "s4", title: "Wave 2 Story 1", wave: 2 },
      ];

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Multi-Wave Sprint",
        branch: "feature/multi-wave",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: stories.map((s) => ({
          ...s,
          status: "queued",
          complexity: "normal",
        })),
      });

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const data = sprintDoc.data();

      const wave0Stories = data?.stories.filter((s: any) => s.wave === 0);
      const wave1Stories = data?.stories.filter((s: any) => s.wave === 1);
      const wave2Stories = data?.stories.filter((s: any) => s.wave === 2);

      expect(wave0Stories).toHaveLength(2);
      expect(wave1Stories).toHaveLength(1);
      expect(wave2Stories).toHaveLength(1);
    });
  });

  describe("Story Status Transitions", () => {
    it("should transition story from queued to active to complete", async () => {
      const sprintId = "sprint-003";
      const storyId = "story-1";

      // Create sprint
      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Test Project",
        branch: "feature/test",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          {
            id: storyId,
            title: "Test Story",
            status: "queued",
            wave: 0,
            complexity: "normal",
          },
        ],
      });

      // Transition to active
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        stories: [
          {
            id: storyId,
            title: "Test Story",
            status: "active",
            wave: 0,
            complexity: "normal",
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            currentAction: "Running tests",
            progress: 50,
          },
        ],
      });

      let sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      let story = sprintDoc.data()?.stories[0];

      expect(story.status).toBe("active");
      expect(story.startedAt).toBeDefined();
      expect(story.progress).toBe(50);

      // Transition to complete
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        stories: [
          {
            id: storyId,
            title: "Test Story",
            status: "complete",
            wave: 0,
            complexity: "normal",
            startedAt: story.startedAt,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            progress: 100,
          },
        ],
      });

      sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      story = sprintDoc.data()?.stories[0];

      expect(story.status).toBe("complete");
      expect(story.completedAt).toBeDefined();
      expect(story.progress).toBe(100);
    });

    it("should handle failed story status", async () => {
      const sprintId = "sprint-004";
      const storyId = "story-fail";

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Test Project",
        branch: "feature/test",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          {
            id: storyId,
            title: "Failing Story",
            status: "active",
            wave: 0,
            complexity: "normal",
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        ],
      });

      // Mark as failed
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        "stories.0.status": "failed",
        "stories.0.failedAt": admin.firestore.FieldValue.serverTimestamp(),
        "stories.0.error": "Build failed",
        "stories.0.retryCount": 1,
      });

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const story = sprintDoc.data()?.stories[0];

      expect(story.status).toBe("failed");
      expect(story.failedAt).toBeDefined();
      expect(story.error).toBe("Build failed");
      expect(story.retryCount).toBe(1);
    });

    it("should handle skipped story status", async () => {
      const sprintId = "sprint-005";

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Test Project",
        branch: "feature/test",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          {
            id: "story-skip",
            title: "Skipped Story",
            status: "skipped",
            wave: 0,
            complexity: "normal",
            skipReason: "Dependency failed",
          },
        ],
      });

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const story = sprintDoc.data()?.stories[0];

      expect(story.status).toBe("skipped");
      expect(story.skipReason).toBe("Dependency failed");
    });
  });

  describe("Wave Progression", () => {
    it("should advance to next wave when current wave is complete", async () => {
      const sprintId = "sprint-006";

      // Create sprint with two waves
      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Wave Test",
        branch: "feature/waves",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          { id: "s1", title: "Wave 0 Story 1", status: "complete", wave: 0, complexity: "normal" },
          { id: "s2", title: "Wave 0 Story 2", status: "complete", wave: 0, complexity: "normal" },
          { id: "s3", title: "Wave 1 Story 1", status: "queued", wave: 1, complexity: "normal" },
        ],
      });

      // Check wave 0 is complete
      let sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      let data = sprintDoc.data();
      const wave0Stories = data?.stories.filter((s: any) => s.wave === 0);
      const allWave0Complete = wave0Stories.every((s: any) => s.status === "complete");

      expect(allWave0Complete).toBe(true);

      // Advance to wave 1
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        currentWave: 1,
      });

      sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      expect(sprintDoc.data()?.currentWave).toBe(1);
    });

    it("should handle concurrent story execution within a wave", async () => {
      const sprintId = "sprint-007";

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Concurrent Test",
        branch: "feature/concurrent",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        config: {
          maxConcurrent: 3,
        },
        stories: [
          { id: "s1", title: "Story 1", status: "active", wave: 0, complexity: "normal" },
          { id: "s2", title: "Story 2", status: "active", wave: 0, complexity: "normal" },
          { id: "s3", title: "Story 3", status: "active", wave: 0, complexity: "normal" },
          { id: "s4", title: "Story 4", status: "queued", wave: 0, complexity: "normal" },
        ],
      });

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const activeStories = sprintDoc.data()?.stories.filter((s: any) => s.status === "active");

      expect(activeStories).toHaveLength(3);
      expect(sprintDoc.data()?.config.maxConcurrent).toBe(3);
    });
  });

  describe("Sprint Completion", () => {
    it("should complete sprint with summary stats", async () => {
      const sprintId = "sprint-008";

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Complete Test",
        branch: "feature/complete",
        status: "active",
        currentWave: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        stories: [
          { id: "s1", title: "Story 1", status: "complete", wave: 0, complexity: "normal" },
          { id: "s2", title: "Story 2", status: "complete", wave: 0, complexity: "normal" },
          { id: "s3", title: "Story 3", status: "failed", wave: 0, complexity: "normal" },
          { id: "s4", title: "Story 4", status: "skipped", wave: 0, complexity: "normal" },
        ],
      });

      // Calculate summary
      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const stories = sprintDoc.data()?.stories || [];
      const summary = {
        completed: stories.filter((s: any) => s.status === "complete").length,
        failed: stories.filter((s: any) => s.status === "failed").length,
        skipped: stories.filter((s: any) => s.status === "skipped").length,
        total: stories.length,
      };

      // Complete sprint
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        status: "complete",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        summary,
      });

      const completedSprint = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const data = completedSprint.data();

      expect(data?.status).toBe("complete");
      expect(data?.completedAt).toBeDefined();
      expect(data?.summary.completed).toBe(2);
      expect(data?.summary.failed).toBe(1);
      expect(data?.summary.skipped).toBe(1);
      expect(data?.summary.total).toBe(4);
    });

    it("should calculate sprint duration", async () => {
      const sprintId = "sprint-009";
      const createdAt = admin.firestore.Timestamp.now();

      await db.collection(`users/${userId}/sprints`).doc(sprintId).set({
        projectName: "Duration Test",
        branch: "feature/duration",
        status: "active",
        currentWave: 0,
        createdAt,
        stories: [
          { id: "s1", title: "Story 1", status: "complete", wave: 0, complexity: "normal" },
        ],
      });

      // Simulate some time passing
      await new Promise((resolve) => setTimeout(resolve, 100));

      const completedAt = admin.firestore.Timestamp.now();
      await db.collection(`users/${userId}/sprints`).doc(sprintId).update({
        status: "complete",
        completedAt,
      });

      const sprintDoc = await db.collection(`users/${userId}/sprints`).doc(sprintId).get();
      const data = sprintDoc.data();

      const durationMs = data?.completedAt.toMillis() - data?.createdAt.toMillis();
      expect(durationMs).toBeGreaterThan(0);
    });
  });
});
