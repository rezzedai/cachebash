/**
 * Grid Program Registry — Known programs on The Grid.
 * Used for key binding validation and target verification.
 */

export const GRID_PROGRAMS = [
  'iso', 'basher', 'alan', 'quorra', 'radia', 'sark',
  'casp', 'clu', 'able', 'beck', 'gem', 'rinzler',
  'tron', 'yori', 'pixel', 'castor', 'ram', 'scribe',
  'sage', 'link', 'dumont', 'gridbot', 'bit', 'byte',
  'tesler', 'flynns-mirror', 'council', 'codex', 'vector'
] as const;

export type GridProgramId = typeof GRID_PROGRAMS[number];

/** Check if a string is a known program ID */
export function isGridProgram(id: string): id is GridProgramId {
  return (GRID_PROGRAMS as readonly string[]).includes(id);
}

/** Special program IDs for backward compat and mobile */
export const SPECIAL_PROGRAMS = ['legacy', 'mobile'] as const;
export type SpecialProgramId = typeof SPECIAL_PROGRAMS[number];

/** All valid program IDs including special ones */
export type ValidProgramId = GridProgramId | SpecialProgramId;

export function isValidProgram(id: string): id is ValidProgramId {
  return isGridProgram(id) || (SPECIAL_PROGRAMS as readonly string[]).includes(id);
}

/** Named groups for multicast routing */
export const PROGRAM_GROUPS: Record<string, readonly GridProgramId[]> = {
  council: ['iso', 'alan', 'quorra', 'sark', 'casp', 'radia', 'vector'],
  builders: ['basher', 'able', 'beck'],
  intelligence: ['clu', 'beck', 'scribe'],
  all: [...GRID_PROGRAMS].filter(p => p !== 'council'), // All individual programs except the 'council' meta-entry
};

/** Check if a target is a group name */
export function isGroupTarget(target: string): target is keyof typeof PROGRAM_GROUPS {
  return target in PROGRAM_GROUPS;
}

/** Resolve a target to an array of individual program IDs */
export function resolveTargets(target: string): string[] {
  if (isGroupTarget(target)) {
    return [...PROGRAM_GROUPS[target]];
  }
  return [target];
}

/** Program display metadata for Grid Portal */
export interface ProgramMeta {
  displayName: string;
  color: string;
  role: string;
}

export const PROGRAM_REGISTRY: Partial<Record<GridProgramId, ProgramMeta>> = {
  iso:    { displayName: "ISO",    color: "#6FC3DF", role: "Orchestrator" },
  basher: { displayName: "BASHER", color: "#E87040", role: "Execution Engine" },
  alan:   { displayName: "ALAN",   color: "#4A8ED4", role: "Architecture" },
  quorra: { displayName: "QUORRA", color: "#9B6FC0", role: "Design" },
  sark:   { displayName: "SARK",   color: "#C44040", role: "Audit" },
  able:   { displayName: "ABLE",   color: "#4DB870", role: "Growth" },
  beck:   { displayName: "BECK",   color: "#40A8A0", role: "Operations" },
  radia:  { displayName: "RADIA",  color: "#E8E0D0", role: "Vision" },
  codex:  { displayName: "CODEX",  color: "#10A37F", role: "Cross-Model Builder" },
  vector: { displayName: "VECTOR", color: "#C4A052", role: "Strategic Counsel" },
};
