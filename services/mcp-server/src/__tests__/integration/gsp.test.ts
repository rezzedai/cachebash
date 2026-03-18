/**
 * GSP Module — Integration Tests (4 scenarios)
 * Runs against Firestore emulator. Requires FIRESTORE_EMULATOR_HOST=localhost:8080.
 */

import { getTestFirestore, clearFirestoreData, seedTestUser } from "./setup";
import * as gsp from "../../modules/gsp";
import type { AuthContext } from "../../auth/authValidator";
import type * as admin from "firebase-admin";

let db: admin.firestore.Firestore;
let testUser: Awaited<ReturnType<typeof seedTestUser>>;
let auth: AuthContext;

beforeAll(() => {
  db = getTestFirestore();
});

beforeEach(async () => {
  await clearFirestoreData();
  testUser = await seedTestUser("integ-gsp-user");

  // Seed program registry (needed for bootstrap, propose, etc.)
  await db.doc(`tenants/${testUser.userId}/programs/vector`).set({
    programId: "vector",
    displayName: "Vector",
    role: "orchestrator",
    groups: ["council"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });
  await db.doc(`tenants/${testUser.userId}/programs/basher`).set({
    programId: "basher",
    displayName: "Basher",
    role: "builder",
    groups: ["builders"],
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });

  auth = {
    userId: testUser.userId,
    apiKeyHash: testUser.apiKeyHash,
    programId: "vector" as any,
    encryptionKey: testUser.encryptionKey,
    capabilities: ["*"],
    rateLimitTier: "internal",
  };
});

function parse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 1: Write → Read → Diff workflow
// ═════════════════════════════════════════════════════════════════════════════

describe("Write → Read → Diff workflow", () => {
  it("write creates entry, read retrieves it, diff shows it as changed", async () => {
    // Step 1: Write
    const writeResult = await gsp.gspWriteHandler(auth, {
      namespace: "runtime",
      key: "config-a",
      value: { setting: true },
    });
    const writeData = parse(writeResult);
    expect(writeData.success).toBe(true);
    expect(writeData.version).toBe(1);
    expect(writeData.action).toBe("created");

    // Step 2: Read back
    const readResult = await gsp.gspReadHandler(auth, {
      namespace: "runtime",
      key: "config-a",
    });
    const readData = parse(readResult);
    expect(readData.success).toBe(true);
    expect(readData.found).toBe(true);
    expect(readData.entry.value).toEqual({ setting: true });

    // Step 3: Update same key
    const updateResult = await gsp.gspWriteHandler(auth, {
      namespace: "runtime",
      key: "config-a",
      value: { setting: false, extra: "added" },
    });
    const updateData = parse(updateResult);
    expect(updateData.success).toBe(true);
    expect(updateData.version).toBe(2);
    expect(updateData.action).toBe("updated");

    // Step 4: Diff since v1
    const diffResult = await gsp.gspDiffHandler(auth, {
      namespace: "runtime",
      sinceVersion: 1,
    });
    const diffData = parse(diffResult);
    expect(diffData.success).toBe(true);
    expect(diffData.count).toBe(1);
    expect(diffData.changes[0].version).toBe(2);

    // Step 5: Read again to confirm latest
    const readAgain = await gsp.gspReadHandler(auth, {
      namespace: "runtime",
      key: "config-a",
    });
    const readAgainData = parse(readAgain);
    expect(readAgainData.entry.version).toBe(2);
    expect(readAgainData.entry.value).toEqual({ setting: false, extra: "added" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 2: Propose → Resolve(approve) → Verify state
// ═════════════════════════════════════════════════════════════════════════════

describe("Propose → Resolve(approve) → Verify state", () => {
  it("full governance proposal lifecycle", async () => {
    // Step 1: Seed constitutional entry via gsp_seed
    const seedResult = await gsp.gspSeedHandler(auth, {
      namespace: "constitution",
      entries: [
        { key: "test-rule", value: "old", tier: "constitutional" as const },
      ],
    });
    const seedData = parse(seedResult);
    expect(seedData.success).toBe(true);
    expect(seedData.seeded).toBe(1);

    // Step 2: Subscribe to constitution namespace
    const subResult = await gsp.gspSubscribeHandler(auth, {
      namespace: "constitution",
    });
    const subData = parse(subResult);
    expect(subData.success).toBe(true);

    // Step 3: Propose change (as basher)
    const basherAuth: AuthContext = { ...auth, programId: "basher" as any };
    const proposeResult = await gsp.gspProposeHandler(basherAuth, {
      namespace: "constitution",
      key: "test-rule",
      proposedValue: "new",
      rationale: "Better rule",
    });
    const proposeData = parse(proposeResult);
    expect(proposeData.success).toBe(true);
    expect(proposeData.reviewers).toBeDefined();
    expect(proposeData.status).toBe("pending");

    const proposalId = proposeData.proposalId;

    // Step 4: Resolve with approval
    // Constitutional proposals are reviewed by "flynn". For integration test,
    // we read the actual proposal to get reviewers, then auth as reviewer.
    const proposalDoc = await db
      .doc(`tenants/${testUser.userId}/gsp_proposals/${proposalId}`)
      .get();
    const proposalData = proposalDoc.data()!;
    const reviewer = proposalData.reviewers[0]; // "flynn"

    // Auth as reviewer (flynn is not a standard program, but we can set it directly)
    const reviewerAuth: AuthContext = { ...auth, programId: reviewer as any };

    const resolveResult = await gsp.gspResolveHandler(reviewerAuth, {
      proposalId,
      decision: "approved",
    });
    const resolveData = parse(resolveResult);
    expect(resolveData.success).toBe(true);
    expect(resolveData.stateUpdated).toBe(true);

    // Step 5: Read constitution/test-rule → value should be "new"
    const readResult = await gsp.gspReadHandler(auth, {
      namespace: "constitution",
      key: "test-rule",
    });
    const readData = parse(readResult);
    expect(readData.found).toBe(true);
    expect(readData.entry.value).toBe("new");
    expect(readData.entry.version).toBeGreaterThan(1);

    // Step 6: Verify proposal status is "approved"
    const resolvedProposal = await db
      .doc(`tenants/${testUser.userId}/gsp_proposals/${proposalId}`)
      .get();
    expect(resolvedProposal.data()!.status).toBe("approved");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 3: Bootstrap depth tiers
// ═════════════════════════════════════════════════════════════════════════════

describe("Bootstrap depth tiers", () => {
  beforeEach(async () => {
    const userId = testUser.userId;

    // Constitutional entries
    await gsp.gspSeedHandler(auth, {
      namespace: "constitution",
      entries: [
        {
          key: "shared-execution-rules",
          tier: "constitutional" as const,
          value: {
            hardRules: [
              { key: "r1", value: "Rule 1" },
              { key: "r2", value: "Rule 2" },
              { key: "r3", value: "Rule 3" },
              { key: "r4", value: "Rule 4" },
            ],
            escalationPolicy: [
              { key: "e1", value: "Escalation 1" },
            ],
          },
        },
        {
          key: "guiding-light",
          tier: "constitutional" as const,
          value: "Full guiding light text with all tenets and principles...",
        },
      ],
    });

    // Architectural entries
    await gsp.gspSeedHandler(auth, {
      namespace: "architecture",
      entries: [
        {
          key: "decision-auth",
          tier: "architectural" as const,
          value: "Use JWT tokens",
          description: "Auth decision",
        },
        {
          key: "service-api",
          tier: "architectural" as const,
          value: "MCP over HTTP",
          description: "API service def",
        },
      ],
    });

    // Tasks for context
    await db.doc(`tenants/${userId}/tasks/task-1`).set({
      target: "basher",
      title: "Build login",
      priority: "high",
      action: "queue",
      status: "created",
      createdAt: new Date().toISOString(),
    });

    // Messages for context
    await db.doc(`tenants/${userId}/relay/msg-1`).set({
      target: "basher",
      source: "iso",
      message_type: "DIRECTIVE",
      message: "Deploy hotfix",
      status: "pending",
      priority: "high",
      createdAt: new Date().toISOString(),
    });

    // Session
    await db.doc(`tenants/${userId}/sessions/sess-1`).set({
      programId: "basher",
      state: "active",
      createdAt: new Date().toISOString(),
    });

    // Program state with learned patterns
    await db.doc(`tenants/${userId}/programs/basher/state`).set({
      learnedPatterns: [
        {
          id: "p1",
          domain: "testing",
          pattern: "Mock Firestore in unit tests",
          confidence: 0.9,
          evidence: "Consistent success",
          discoveredAt: "2026-01-01T00:00:00Z",
          stale: false,
        },
      ],
      contextSummary: {
        lastTask: { taskId: "t1", title: "Build login", outcome: "success", notes: "" },
        activeWorkItems: ["login-feature"],
        handoffNotes: "Continue with OAuth",
        openQuestions: ["Which OAuth provider?"],
      },
    });
  });

  it("essential vs standard vs full payloads", async () => {
    // Essential depth
    const essentialResult = await gsp.gspBootstrapHandler(auth, {
      agentId: "basher",
      depth: "essential",
    });
    const essential = parse(essentialResult).payload;
    expect(essential.constitutional.hardRules.length).toBeLessThanOrEqual(3);
    expect(essential.architectural.activeDecisions).toEqual([]);
    expect(essential.context.pendingTasks.length).toBeLessThanOrEqual(10);

    // Standard depth
    const standardResult = await gsp.gspBootstrapHandler(auth, {
      agentId: "basher",
      depth: "standard",
    });
    const standard = parse(standardResult).payload;
    expect(standard.constitutional.hardRules.length).toBeLessThanOrEqual(10);
    expect(standard.architectural.activeDecisions.length).toBeGreaterThan(0);

    // Full depth (as vector for full orchestrator payload)
    const fullResult = await gsp.gspBootstrapHandler(auth, {
      agentId: "vector",
      depth: "full",
    });
    const full = parse(fullResult).payload;
    expect(full.constitutional.hardRules.length).toBeGreaterThan(0);
    expect(full.architectural.activeDecisions.length).toBeGreaterThan(0);
    // Full uses raw guiding light from Firestore
    expect(full.constitutional.guidingLightDigest).toContain("Full guiding light");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 4: Subscription notification delivery
// ═════════════════════════════════════════════════════════════════════════════

describe("Subscription notification delivery", () => {
  it("write triggers subscriber notification", async () => {
    // Step 1: Subscribe "basher" to runtime namespace
    const basherAuth: AuthContext = { ...auth, programId: "basher" as any };
    const subResult = await gsp.gspSubscribeHandler(basherAuth, {
      namespace: "runtime",
    });

    // gspSubscribe requires namespace to exist — write an initial entry first
    // Actually, need to seed namespace before subscribing. Let's write first.
    // Re-do: write first to create namespace, then subscribe, then write again.

    // Write initial entry to create namespace
    await gsp.gspWriteHandler(auth, {
      namespace: "runtime",
      key: "seed-entry",
      value: "init",
    });

    // Subscribe basher
    const subResult2 = await gsp.gspSubscribeHandler(basherAuth, {
      namespace: "runtime",
    });
    const subData = parse(subResult2);
    expect(subData.success).toBe(true);

    // Step 2: Write to runtime/config-a (triggers notification)
    await gsp.gspWriteHandler(auth, {
      namespace: "runtime",
      key: "config-a",
      value: { updated: true },
    });

    // Step 3: Query relay messages for basher
    const relaySnap = await db
      .collection(`tenants/${testUser.userId}/relay`)
      .where("target", "==", "basher")
      .get();

    // Should have at least 1 notification containing [GSP_CHANGE]
    const notifications = relaySnap.docs
      .map((d) => d.data())
      .filter((m) => m.message && m.message.includes("[GSP_CHANGE]"));

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].message).toContain("runtime/config-a");
    expect(notifications[0].message_type).toBe("RESULT");
  });
});
