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
  ["builder", {
    programId: "builder",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Execution engine — builds, deploys, tests",
  }],
  ["architect", {
    programId: "architect",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Architecture — schema design, technical assessment",
  }],
  ["auditor", {
    programId: "auditor",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Security — audit, access control, compliance",
  }],
  ["reviewer", {
    programId: "reviewer",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Design — pragmatic solutions, creative problem-solving",
  }],
  ["designer", {
    programId: "designer",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Vision — product direction, unconstrained ideation",
  }],
  ["growth", {
    programId: "growth",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Growth — external-facing, client work",
  }],
  ["ops", {
    programId: "ops",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Operations — infrastructure, DevOps",
  }],
  ["memory", {
    programId: "memory",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Knowledge — pattern store, memory management",
  }],
  ["strategist", {
    programId: "strategist",
    spawnable: true,
    model: "opus",
    repo: "",
    description: "Strategic counsel — architecture, roadmap, council contributions",
  }],
  ["vector", {
    programId: "vector",
    spawnable: true,
    model: "opus",
    repo: "rezzed-ai",
    description: "Flynn's exclusive strategic interface — directive authority over ISO",
  }],
]);

/** Check if a program is spawnable by the wake daemon */
export function isSpawnable(programId: string): boolean {
  return SPAWNABLE_PROGRAMS.has(programId);
}
