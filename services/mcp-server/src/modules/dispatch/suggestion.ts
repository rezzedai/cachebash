/**
 * Wave 16: Target Suggestion Tool — Query optimal targets based on historical success data.
 */

import { getFirestore } from "../../firebase/client.js";
import { AuthContext } from "../../auth/authValidator.js";
import { z } from "zod";
import { type ToolResult, jsonResult } from "./shared.js";
import { isProgramPaused, isProgramQuarantined } from "../pulse.js";

const SuggestTargetSchema = z.object({
  taskType: z.string().optional(),
  title: z.string().optional(),
  instructions: z.string().optional(),
});

interface RankedProgram {
  programId: string;
  successRate: number;
  totalCompletions: number;
  avgDurationMs: number;
}

/**
 * Suggest optimal targets based on historical success rates.
 * Returns ranked list of programs with success rates for matching task characteristics.
 */
export async function suggestTargetHandler(auth: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const args = SuggestTargetSchema.parse(rawArgs);
  const db = getFirestore();

  // Default to "task" type if not specified
  const taskType = args.taskType || "task";

  try {
    // Query all program stats
    const statsSnapshot = await db.collection(`tenants/${auth.userId}/program_stats`).get();

    if (statsSnapshot.empty) {
      return jsonResult({
        success: true,
        ranked_programs: [],
        message: "No program stats available yet. Stats are built as tasks complete.",
      });
    }

    // Collect programs with stats for the requested task type
    const programs: RankedProgram[] = [];

    for (const doc of statsSnapshot.docs) {
      const programId = doc.id;
      const data = doc.data();

      // Check if program is paused or quarantined
      const isPaused = await isProgramPaused(auth.userId, programId);
      const isQuarantined = await isProgramQuarantined(auth.userId, programId);

      if (isPaused || isQuarantined) {
        continue; // Skip unavailable programs
      }

      const taskTypeStats = data.taskTypeSuccessRates?.[taskType];

      if (!taskTypeStats || taskTypeStats.total === 0) {
        continue; // No stats for this task type
      }

      programs.push({
        programId,
        successRate: taskTypeStats.success / taskTypeStats.total,
        totalCompletions: taskTypeStats.total,
        avgDurationMs: taskTypeStats.avgDuration || 0,
      });
    }

    // Sort by success rate (descending), then by sample size (descending)
    programs.sort((a, b) => {
      if (Math.abs(a.successRate - b.successRate) > 0.01) {
        return b.successRate - a.successRate; // Higher success rate first
      }
      return b.totalCompletions - a.totalCompletions; // More completions breaks ties
    });

    return jsonResult({
      success: true,
      ranked_programs: programs.map((p) => ({
        programId: p.programId,
        success_rate: Math.round(p.successRate * 10000) / 100, // e.g., 87.5%
        total_completions: p.totalCompletions,
        avg_duration_ms: Math.round(p.avgDurationMs),
      })),
      task_type: taskType,
      message: `Found ${programs.length} program(s) with historical data for "${taskType}" tasks.`,
    });
  } catch (error) {
    return jsonResult({
      success: false,
      error: `Failed to suggest targets: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
