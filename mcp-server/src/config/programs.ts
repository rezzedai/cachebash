/**
 * Grid Program Registry — Known programs on The Grid.
 * Used for key binding validation and target verification.
 */

export const GRID_PROGRAMS = [
  'iso', 'basher', 'alan', 'quorra', 'radia', 'sark',
  'casp', 'clu', 'able', 'beck', 'gem', 'rinzler',
  'tron', 'yori', 'pixel', 'castor', 'ram', 'scribe',
  'sage', 'link', 'dumont', 'gridbot', 'bit', 'byte',
  'tesler', 'flynns-mirror', 'council'
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
  council: ['iso', 'alan', 'quorra', 'sark', 'casp', 'radia'],
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
