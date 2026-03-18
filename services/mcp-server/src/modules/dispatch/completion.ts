/**
 * Dispatch Module — Task completion (complete_task, batch_complete).
 * Collection: tenants/{uid}/tasks
 */

import { getFirestore, serverTimestamp } from "../../firebase/client.js";
import * as admin from "firebase-admin";
import { AuthContext } from "../../auth/authValidator.js";
import { transition, type LifecycleStatus } from "../../lifecycle/engine.js";
import { z } from "zod";
import { syncTaskCompleted } from "../github-sync.js";
import { emitEvent, computeHash } from "../events.js";
import { emitAnalyticsEvent } from "../analytics.js";
import { checkDreamBudget, updateDreamConsumption } from "../budget.js";
import { type ToolResult, jsonResult, buildTransition, appendTransition } from "./shared.js";
import { CONSTANTS } from "../../config/constants.js";

const CompleteTaskSchema = z.object({
  taskId: z.string(),
  tokens_in: z.number().nonnegative().optional(),
  tokens_out: z.number().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  model: z.string(),
  provider: z.string(),
  result: z.string().max(4000).optional(),
  error_code: z.string().optional(),
  error_class: z.enum(["TRANSIENT", "PERMANENT", "DEPENDENCY", "POLICY", "TIMEOUT", "UNKNOWN"]).optional(),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

const BatchCompleteTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(CONSTANTS.limits.batchCompleteMax),
  completed_status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "CANCELLED"]).default("SUCCESS"),
  result: z.string().max(4000).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  // Agent Trace L2
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});

/**
 * Tenant compliance config types
 *
 * Wave 1.1 — Tenant Compliance Config (tenants/{userId}/_meta/compliance)
 *
 * Schema:
 *   telemetryMode: "strict" | "lenient" | "off"
 *     - strict: Reject task completion if model/provider missing
 *     - lenient: Log warning but allow completion (default for existing tenants)
 *     - off: Skip telemetry validation entirely
 *
 * Default behavior:
 *   - Existing tenants: "lenient" (backwards compatible)
 *   - New tenants: "strict" (should be set during onboarding)
 */
type TelemetryMode = "strict" | "lenient" | "off";

interface ComplianceConfig {
  telemetryMode: TelemetryMode;
}

/**
 * Read tenant compliance config from tenants/{userId}/_meta/compliance
 * Defaults to "lenient" if not found (for existing tenants)
 */
async function getTenantComplianceConfig(userId: string): Promise<ComplianceConfig> {
  const db = getFirestore();
  try {
    const doc = await db.doc(`tenants/${userId}/_meta/compliance`).get();
    if (!doc.exists) {
      // Default to lenient for existing tenants
      return { telemetryMode: "lenient" };
    }
    const data = doc.data()!;
    const telemetryMode = (data.telemetryMode as TelemetryMode) || "lenient";
    return { telemetryMode };
  } catch (err) {
    console.error("[Compliance] Failed to read config, defaulting to lenient:", err);
    return { telemetryMode: "lenient" };
  }
}

/**
 * Initialize or update tenant compliance config
 * Call during tenant onboarding to set initial mode to "strict" for new tenants
 * Can also be used to update existing tenant preferences
 */
async function setTenantComplianceConfig(
  userId: string,
  telemetryMode: TelemetryMode,
): Promise<void> {
  const db = getFirestore();
  await db.doc(`tenants/${userId}/_meta/compliance`).set(
    {
      telemetryMode,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Validate telemetry fields based on tenant compliance mode
 * Returns error message if validation fails in strict mode, null otherwise
 */
async function validateTelemetryCompliance(
  userId: string,
  model: string | undefined,
  provider: string | undefined,
): Promise<string | null> {
  const config = await getTenantComplianceConfig(userId);

  // off mode: skip validation entirely
  if (config.telemetryMode === "off") {
    return null;
  }

  const missingFields: string[] = [];
  if (!model) missingFields.push("model");
  if (!provider) missingFields.push("provider");

  if (missingFields.length === 0) {
    return null; // all fields present
  }

  // strict mode: reject missing fields
  if (config.telemetryMode === "strict") {
    return `Telemetry fields required in strict mode: ${missingFields.join(", ")}`;
  }

  // lenient mode: log warning but allow
  if (config.telemetryMode === "lenient") {
    console.warn(`[Compliance] Telemetry fields missing (lenient mode): ${missingFields.join(", ")}`);
    return null;
  }

  return null;
}

// Auto-Quarantine: Track failure count and quarantine on threshold
const QUARANTINE_FAILURE_THRESHOLD = 3;
const QUARANTINE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function handleAutoQuarantine(
  db: admin.firestore.Firestore,
  userId: string,
  programId: string
): Promise<void> {
  const programRef = db.doc(`tenants/${userId}/programs/${programId}`);
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - QUARANTINE_WINDOW_MS);

  try {
    const shouldQuarantine = await db.runTransaction(async (tx) => {
      const doc = await tx.get(programRef);
      const data = doc.exists ? doc.data()! : {};

      // Skip if already quarantined
      if (data.quarantined === true) {
        return false;
      }

      // Increment failure count
      const lastFailureAt = data.lastFailureAt as admin.firestore.Timestamp | undefined;
      const currentCount = (data.failureCount as number) || 0;

      // Reset count if last failure was more than 1 hour ago
      const newCount = lastFailureAt && lastFailureAt.toMillis() < oneHourAgo.toMillis()
        ? 1
        : currentCount + 1;

      tx.set(
        programRef,
        {
          failureCount: newCount,
          lastFailureAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Check if threshold exceeded
      return newCount >= QUARANTINE_FAILURE_THRESHOLD;
    });

    // If threshold exceeded, quarantine the program
    if (shouldQuarantine) {
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(programRef);
        // Double-check not already quarantined (race condition guard)
        if (doc.exists && doc.data()?.quarantined === true) {
          return;
        }

        tx.set(
          programRef,
          {
            quarantined: true,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
            quarantineReason: `Automatic: ${QUARANTINE_FAILURE_THRESHOLD}+ failures in rolling window`,
            quarantinedBy: "system",
          },
          { merge: true }
        );
      });

      // Emit telemetry event
      emitEvent(userId, {
        event_type: "PROGRAM_QUARANTINED",
        program_id: programId,
        quarantined_by: "system",
        reason: `Automatic: ${QUARANTINE_FAILURE_THRESHOLD}+ failures in rolling window`,
        auto_quarantine: true,
      });

      console.log(`[AutoQuarantine] Program "${programId}" auto-quarantined after ${QUARANTINE_FAILURE_THRESHOLD} failures`);
    }
  } catch (err) {
    console.error("[AutoQuarantine] Failed to process:", err);
  }
}

// ISO Self-Recycling: Handle program self-recycle request
const SPAWN_COOLDOWN_MS = CONSTANTS.cooldowns.spawnCooldownMs;

async function handleSelfRecycle(
  db: admin.firestore.Firestore,
  userId: string,
  programId: string
): Promise<void> {
  const metaRef = db.doc(`tenants/${userId}/sessions/_meta/programs/${programId}`);

  // Fleet gate: Check for active tasks (outside transaction — safe false positive)
  const activeTasksSnapshot = await db
    .collection(`tenants/${userId}/tasks`)
    .where("target", "==", programId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!activeTasksSnapshot.empty) {
    console.log(`[SelfRecycle] ${programId} has active tasks, blocking recycle`);
    return;
  }

  // Atomic cooldown check + session creation via transaction
  const result = await db.runTransaction(async (tx) => {
    const metaDoc = await tx.get(metaRef);
    if (metaDoc.exists) {
      const lastSpawn = metaDoc.data()?.lastSpawnAt?.toDate();
      if (lastSpawn && Date.now() - lastSpawn.getTime() < SPAWN_COOLDOWN_MS) {
        return { spawned: false, reason: "cooldown" } as const;
      }
    }

    const sessionId = `${programId}.recycle-${Date.now()}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    tx.set(db.doc(`tenants/${userId}/sessions/${sessionId}`), {
      name: `${programId} - Self-Recycle`,
      programId,
      status: "active",
      bootType: "orchestrator",
      currentAction: "Recycling from high context",
      progress: 0,
      projectName: null,
      lastUpdate: now,
      createdAt: now,
      lastHeartbeat: now,
      archived: false,
    });

    tx.set(metaRef, { lastSpawnAt: now }, { merge: true });

    return { spawned: true, sessionId } as const;
  });

  if (result.spawned) {
    console.log(`[SelfRecycle] Spawned new session for ${programId}: ${result.sessionId}`);
    emitEvent(userId, {
      event_type: "PROGRAM_WAKE",
      program_id: programId,
      session_id: result.sessionId,
    });
  } else {
    console.log(`[SelfRecycle] ${programId} in cooldown, skipping`);
  }
}

// W1.3.6: Budget threshold alerting helper
async function checkBudgetThresholdsAndAlert(
  db: admin.firestore.Firestore,
  userId: string,
  programId: string
): Promise<void> {
  const billingConfigDoc = await db.doc(`tenants/${userId}/_meta/billing`).get();
  if (!billingConfigDoc.exists) return;

  const billingConfig = billingConfigDoc.data();
  const monthlyBudgetUsd = billingConfig?.monthlyBudgetUsd as number | null;
  const alertThresholds = (billingConfig?.alertThresholds as number[]) || [];

  if (!monthlyBudgetUsd || monthlyBudgetUsd <= 0 || alertThresholds.length === 0) return;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const aggregatesSnapshot = await db
    .collection(`tenants/${userId}/usage_aggregates`)
    .where("periodType", "==", "month")
    .where("period", "==", monthKey)
    .get();

  let currentMonthSpend = 0;
  for (const doc of aggregatesSnapshot.docs) {
    currentMonthSpend += (doc.data().totalCostUsd as number) || 0;
  }

  const usagePercent = (currentMonthSpend / monthlyBudgetUsd) * 100;

  for (const threshold of alertThresholds) {
    if (usagePercent >= threshold) {
      const alertId = `budget_alert_${monthKey}_${threshold}`;
      const existingAlert = await db.doc(`tenants/${userId}/budget_alerts/${alertId}`).get();

      if (!existingAlert.exists) {
        await db.doc(`tenants/${userId}/budget_alerts/${alertId}`).set({
          month: monthKey,
          threshold,
          usagePercent: Math.round(usagePercent * 100) / 100,
          currentSpend: currentMonthSpend,
          budget: monthlyBudgetUsd,
          triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
          programId,
        });

        emitEvent(userId, {
          event_type: "BUDGET_THRESHOLD_ALERT",
          program_id: programId,
          threshold,
          usage_percent: usagePercent,
          current_spend: currentMonthSpend,
          budget: monthlyBudgetUsd,
        });
      }
    }
  }
}

export async function completeTaskHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = CompleteTaskSchema.parse(rawArgs);
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${auth.userId}/tasks/${args.taskId}`);

  // Tenant compliance enforcement (Wave 1.1)
  const complianceError = await validateTelemetryCompliance(auth.userId, args.model, args.provider);
  if (complianceError) {
    return jsonResult({ success: false, error: complianceError });
  }

  // W1.3.2: Budget enforcement - check BEFORE completing task
  if (args.cost_usd && args.cost_usd > 0) {
    try {
      const billingConfigDoc = await db.doc(`tenants/${auth.userId}/_meta/billing`).get();
      if (billingConfigDoc.exists) {
        const billingConfig = billingConfigDoc.data();
        const monthlyBudgetUsd = billingConfig?.monthlyBudgetUsd as number | null;

        if (monthlyBudgetUsd !== null && monthlyBudgetUsd > 0) {
          const now = new Date();
          const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          const aggregatesSnapshot = await db
            .collection(`tenants/${auth.userId}/usage_aggregates`)
            .where("periodType", "==", "month")
            .where("period", "==", monthKey)
            .get();

          let currentMonthSpend = 0;
          for (const doc of aggregatesSnapshot.docs) {
            currentMonthSpend += (doc.data().totalCostUsd as number) || 0;
          }

          const projectedSpend = currentMonthSpend + args.cost_usd;
          if (projectedSpend > monthlyBudgetUsd) {
            return jsonResult({
              success: false,
              error: "BUDGET_EXCEEDED",
              message: `Monthly budget exceeded. Budget: $${monthlyBudgetUsd.toFixed(2)}, Current: $${currentMonthSpend.toFixed(4)}, Task cost: $${args.cost_usd.toFixed(4)}`,
            });
          }
        }
      }
    } catch (err) {
      console.error("[Budget] Failed to check budget, allowing completion:", err);
    }
  }

  // Soft telemetry validation — log gaps, never block completion
  const missingFields: string[] = [];
  if (!args.model) missingFields.push("model");
  if (!args.provider) missingFields.push("provider");
  if (!args.completed_status) missingFields.push("completed_status");
  if (!args.result) missingFields.push("result");
  if (missingFields.length > 0) {
    db.collection(`tenants/${auth.userId}/telemetryGaps`).add({
      taskId: args.taskId,
      programId: auth.programId,
      missingFields,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.error("[Telemetry] Failed to log gap:", err));
  }

  // Capture task data for provenance hashing and budget tracking
  let taskData: {
    instructions?: string;
    source?: string;
    target?: string;
    dreamId?: string;
    sprintParentId?: string;
  } = {};

  let supervisedModeActive = false;

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(taskRef);
      if (!doc.exists) throw new Error("Task not found");

      const data = doc.data()!;
      const current = data.status as LifecycleStatus;

      // Capture task data for provenance hashing and budget tracking (before transaction completes)
      taskData = {
        instructions: data.instructions as string | undefined,
        source: data.source as string | undefined,
        target: data.target as string | undefined,
        dreamId: data.dreamId as string | undefined,
        sprintParentId: data.sprint?.parentId as string | undefined,
      };

      const policyMode = data.policy_mode as string | undefined;
      const supervisedMode = policyMode === "supervised" && args.completed_status !== "FAILED";
      supervisedModeActive = supervisedMode;

      // Determine lifecycle target based on completed_status and policy mode
      let lifecycleTarget: LifecycleStatus;
      if (args.completed_status === "FAILED") {
        lifecycleTarget = "failed";
      } else if (supervisedMode) {
        lifecycleTarget = "completing";
      } else {
        lifecycleTarget = "done";
      }

      transition("task", current, lifecycleTarget);

      // Build state transition
      const transitionEntry = buildTransition(current, lifecycleTarget, auth.programId, "complete");
      const updatedTransitions = appendTransition(data.stateTransitions, transitionEntry);

      const updateFields: Record<string, unknown> = {
        status: lifecycleTarget,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: null,
        completed_status: args.completed_status,
        stateTransitions: updatedTransitions,
      };

      // Set awaitingApproval flag for supervised mode
      if (supervisedMode) {
        updateFields.awaitingApproval = true;
      }
      if (args.tokens_in !== undefined) updateFields.tokens_in = args.tokens_in;
      if (args.tokens_out !== undefined) updateFields.tokens_out = args.tokens_out;
      if (args.cost_usd !== undefined) updateFields.cost_usd = args.cost_usd;
      if (args.model) updateFields.model = args.model;
      if (args.provider) updateFields.provider = args.provider;
      if (args.result) updateFields.result = args.result;
      if (args.error_code) updateFields.last_error_code = args.error_code;
      if (args.error_class) updateFields.last_error_class = args.error_class;
      // Agent Trace L2: propagate trace context on completion
      if (args.traceId) updateFields.traceId = args.traceId;
      if (args.spanId) updateFields.completionSpanId = args.spanId;
      if (args.parentSpanId) updateFields.completionParentSpanId = args.parentSpanId;
      tx.update(taskRef, updateFields);
    });

    // Fire-and-forget: sync completion to GitHub (outside transaction)
    syncTaskCompleted(auth.userId, args.taskId);

    // Budget tracking: update dream consumption if task belongs to a dream and has cost
    if (args.cost_usd && args.cost_usd > 0) {
      let dreamId: string | undefined;

      // Check if task directly has dreamId
      if (taskData.dreamId) {
        dreamId = taskData.dreamId;
      }
      // Check if task is a sprint story that belongs to a dream sprint
      else if (taskData.sprintParentId) {
        try {
          const sprintDoc = await db.doc(`tenants/${auth.userId}/tasks/${taskData.sprintParentId}`).get();
          if (sprintDoc.exists) {
            const sprintData = sprintDoc.data()!;
            dreamId = sprintData.dreamId as string | undefined;
          }
        } catch (err) {
          console.error("[Budget] Failed to check sprint parent for dream context:", err);
        }
      }

      // If we found a dream context, track the cost
      if (dreamId) {
        try {
          // Update dream consumption atomically
          await updateDreamConsumption(auth.userId, dreamId, args.cost_usd);

          // Check if budget exceeded
          const budgetCheck = await checkDreamBudget(auth.userId, dreamId);

          if (!budgetCheck.withinBudget) {
            // Emit BUDGET_EXCEEDED event
            emitEvent(auth.userId, {
              event_type: "BUDGET_EXCEEDED",
              program_id: auth.programId,
              task_id: dreamId,
              consumed: budgetCheck.consumed,
              cap: budgetCheck.cap,
              remaining: budgetCheck.remaining,
            });

            // Send budget alert (synchronous — user must know about budget breach)
            const alertMessage = `Dream ${dreamId} has exceeded its budget cap.

Consumed: $${budgetCheck.consumed.toFixed(4)}
Cap: $${budgetCheck.cap.toFixed(4)}
Overage: $${(budgetCheck.consumed - budgetCheck.cap).toFixed(4)}`;

            try {
              await db.collection(`tenants/${auth.userId}/relay`).add({
                schemaVersion: '2.2' as const,
                source: "system",
                target: "user",
                message_type: "STATUS",
                payload: alertMessage,
                priority: "high",
                action: "queue",
                sessionId: null,
                status: "pending",
                ttl: CONSTANTS.ttl.budgetAlertSeconds,
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CONSTANTS.ttl.budgetAlertSeconds * 1000),
                alertType: "BUDGET_EXCEEDED",
                context: { dreamId, consumed: budgetCheck.consumed, cap: budgetCheck.cap },
                createdAt: serverTimestamp(),
              });
            } catch (err) {
              console.error("[Budget] Failed to send alert:", err);
            }
          }
        } catch (err) {
          console.error("[Budget] Failed to track dream budget:", err);
          // Don't fail the task completion if budget tracking fails
        }
      }
    }

    // Emit telemetry event with cryptographic provenance
    emitEvent(auth.userId, {
      event_type: args.completed_status === "FAILED" ? "TASK_FAILED" : "TASK_SUCCEEDED",
      program_id: auth.programId,
      task_id: args.taskId,
      completed_status: args.completed_status,
      tokens_in: args.tokens_in,
      tokens_out: args.tokens_out,
      cost_usd: args.cost_usd,
      model: args.model,
      provider: args.provider,
      error_code: args.error_code,
      error_class: args.error_class,
      prompt_hash: taskData.instructions ? computeHash(taskData.instructions) : undefined,
      config_hash: taskData.source ? computeHash(`${taskData.source}:${taskData.target}:${args.model || "unknown"}`) : undefined,
    });

    // Supervised mode: emit awaiting approval event
    if (supervisedModeActive) {
      emitEvent(auth.userId, {
        event_type: "TASK_AWAITING_APPROVAL",
        program_id: auth.programId,
        task_id: args.taskId,
      });
    }

    // Analytics: task_lifecycle complete
    emitAnalyticsEvent(auth.userId, {
      eventType: "task_lifecycle",
      programId: auth.programId,
      toolName: "complete_task",
      success: args.completed_status !== "FAILED",
      errorCode: args.error_code,
      errorClass: args.error_class,
    });

    // W1.1.4: Write immutable ledger entry (synchronous — billing audit trail)
    if (args.model || args.tokens_in || args.tokens_out || args.cost_usd) {
      try {
        await db.collection(`tenants/${auth.userId}/usage_ledger`).add({
          taskId: args.taskId,
          model: args.model || null,
          provider: args.provider || null,
          tokens_in: args.tokens_in || 0,
          tokens_out: args.tokens_out || 0,
          cost_usd: args.cost_usd || 0,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          programId: auth.programId,
          taskType: taskData.source || "unknown",
          completed_status: args.completed_status,
          // Agent Trace L2
          traceId: args.traceId || null,
          spanId: args.spanId || null,
          parentSpanId: args.parentSpanId || null,
        });
      } catch (err) {
        console.error("[UsageLedger] Failed to write entry:", err);
      }
    }

    // W1.3.6: Check alert thresholds and emit alerts
    if (args.cost_usd && args.cost_usd > 0) {
      checkBudgetThresholdsAndAlert(db, auth.userId, auth.programId).catch((err) =>
        console.error("[Budget] Failed to check thresholds:", err)
      );
    }

    // ISO Self-Recycling: Detect [RECYCLE] marker and spawn new session
    const taskDoc = await taskRef.get();
    if (taskDoc.exists) {
      const taskTitle = taskDoc.data()?.title as string;
      if (taskTitle && (taskTitle.includes("[RECYCLE]") || taskTitle.toLowerCase().includes("recycle"))) {
        try {
          await handleSelfRecycle(db, auth.userId, auth.programId);
        } catch (err) {
          console.error("[SelfRecycle] Failed:", err);
        }
      }
    }

    // Auto-Quarantine: Track failures and auto-quarantine on threshold
    if (args.completed_status === "FAILED" && taskData.target) {
      try {
        await handleAutoQuarantine(db, auth.userId, taskData.target as string);
      } catch (err) {
        console.error("[AutoQuarantine] Failed:", err);
      }
    }

    return jsonResult({ success: true, taskId: args.taskId, message: "Task marked as done" });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to complete task: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function batchCompleteTasksHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = BatchCompleteTasksSchema.parse(rawArgs);
  const db = getFirestore();

  // Tenant compliance enforcement (Wave 1.1) - shared validation logic
  const complianceError = await validateTelemetryCompliance(auth.userId, args.model, args.provider);
  if (complianceError) {
    return jsonResult({ success: false, error: complianceError });
  }

  // Soft telemetry validation
  const missingFields: string[] = [];
  if (!args.model) missingFields.push("model");
  if (!args.provider) missingFields.push("provider");
  if (missingFields.length > 0) {
    db.collection(`tenants/${auth.userId}/telemetryGaps`).add({
      taskIds: args.taskIds,
      programId: auth.programId,
      missingFields,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err: unknown) => console.error("[Telemetry] Failed to log gap:", err));
  }

  const results: Array<{ taskId: string; success: boolean; error?: string }> = [];

  for (const taskId of args.taskIds) {
    const taskRef = db.doc(`tenants/${auth.userId}/tasks/${taskId}`);
    try {
      let taskData: { instructions?: string; source?: string; target?: string; dreamId?: string } = {};

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(taskRef);
        if (!doc.exists) throw new Error("Task not found");

        const data = doc.data()!;
        const current = data.status as LifecycleStatus;
        taskData = { instructions: data.instructions, source: data.source, target: data.target, dreamId: data.dreamId };

        const lifecycleTarget = args.completed_status === "FAILED" ? "failed" : "done";
        transition("task", current, lifecycleTarget as LifecycleStatus);

        // Build state transition
        const transitionEntry = buildTransition(current, lifecycleTarget, auth.programId, "complete");
        const updatedTransitions = appendTransition(data.stateTransitions, transitionEntry);

        const updateFields: Record<string, unknown> = {
          status: args.completed_status === "FAILED" ? "failed" : "done",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastHeartbeat: null,
          completed_status: args.completed_status,
          stateTransitions: updatedTransitions,
        };
        if (args.result) updateFields.result = args.result;
        if (args.model) updateFields.model = args.model;
        if (args.provider) updateFields.provider = args.provider;
        // Agent Trace L2: propagate trace context on batch complete
        if (args.traceId) updateFields.traceId = args.traceId;
        if (args.spanId) updateFields.completionSpanId = args.spanId;
        if (args.parentSpanId) updateFields.completionParentSpanId = args.parentSpanId;

        tx.update(taskRef, updateFields);
      });

      // Fire-and-forget: sync + telemetry per task
      syncTaskCompleted(auth.userId, taskId);

      emitEvent(auth.userId, {
        event_type: args.completed_status === "FAILED" ? "TASK_FAILED" : "TASK_SUCCEEDED",
        program_id: auth.programId,
        task_id: taskId,
        model: args.model,
        prompt_hash: taskData.instructions ? computeHash(taskData.instructions) : undefined,
        config_hash: taskData.source ? computeHash(`${taskData.source}:${taskData.target}:${args.model}`) : undefined,
      });

      emitAnalyticsEvent(auth.userId, {
        eventType: "task_lifecycle",
        programId: auth.programId,
        toolName: "batch_complete_tasks",
        success: args.completed_status !== "FAILED",
      });

      // W1.1.4: Write immutable ledger entry (synchronous — billing audit trail)
      try {
        await db.collection(`tenants/${auth.userId}/usage_ledger`).add({
          taskId,
          model: args.model || null,
          provider: args.provider || null,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          programId: auth.programId,
          taskType: taskData.source || "unknown",
          completed_status: args.completed_status,
          // Agent Trace L2
          traceId: args.traceId || null,
          spanId: args.spanId || null,
          parentSpanId: args.parentSpanId || null,
        });
      } catch (err) {
        console.error("[UsageLedger] Failed to write entry:", err);
      }

      // Budget tracking per task
      if (taskData.dreamId) {
        try {
          const budgetCheck = await checkDreamBudget(auth.userId, taskData.dreamId);
          if (!budgetCheck.withinBudget) {
            emitEvent(auth.userId, {
              event_type: "BUDGET_EXCEEDED",
              program_id: auth.programId,
              task_id: taskId,
            });
          }
        } catch { /* budget check is best-effort */ }
      }

      results.push({ taskId, success: true });
    } catch (error) {
      results.push({ taskId, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const completed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return jsonResult({ success: true, results, completed, failed });
}
