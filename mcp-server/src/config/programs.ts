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
