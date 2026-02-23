/**
 * Program Launch Configuration — Defines which programs are auto-spawnable.
 * Used by the wake daemon to determine spawn eligibility and parameters.
 */

export interface ProgramLaunchConfig {
  programId: string;
  spawnable: boolean;
  model: "opus" | "sonnet" | "haiku";
  repo: string;
  description: string;
}

/**
 * Map of spawnable programs. Programs not in this map cannot be auto-woken.
 * The wake daemon uses this to determine if a program with pending tasks should be spawned.
 *
 * Note: The actual spawn command is handled by the host listener,
 * not by CacheBash. This config tells the wake daemon WHO can be spawned
 * and passes metadata to the host listener.
 */
export const SPAWNABLE_PROGRAMS: Map<string, ProgramLaunchConfig> = new Map([
  ["basher", {
    programId: "basher",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/basher",
    description: "Execution engine — builds, deploys, tests",
  }],
  ["alan", {
    programId: "alan",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Architecture — schema design, technical assessment",
  }],
  ["sark", {
    programId: "sark",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Security — audit, access control, compliance",
  }],
  ["quorra", {
    programId: "quorra",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Design — pragmatic solutions, creative problem-solving",
  }],
  ["radia", {
    programId: "radia",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Vision — product direction, unconstrained ideation",
  }],
  ["able", {
    programId: "able",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Growth — external-facing, client work",
  }],
  ["beck", {
    programId: "beck",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Operations — infrastructure, DevOps",
  }],
  ["ram", {
    programId: "ram",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Knowledge — pattern store, memory management",
  }],
  ["vector", {
    programId: "vector",
    spawnable: true,
    model: "opus",
    repo: "rezzedai/grid",
    description: "Strategic counsel — architecture, roadmap, council contributions",
  }],
]);

/** Check if a program is spawnable by the wake daemon */
export function isSpawnable(programId: string): boolean {
  return SPAWNABLE_PROGRAMS.has(programId);
}
