/**
 * Program Registry — Known programs in the system.
 * Used for key binding validation and target verification.
 */

export const REGISTERED_PROGRAMS = [
  // Generic roles (backward compat)
  'orchestrator', 'builder', 'architect', 'reviewer', 'designer', 'auditor',
  'planner', 'analyzer', 'growth', 'ops', 'monitor', 'enforcer',
  'coordinator', 'renderer', 'broker', 'memory', 'scribe',
  'sage', 'link', 'gateway', 'healthbot', 'bit', 'byte',
  'tester', 'admin-mirror', 'council', 'codex', 'strategist',
  // Grid program names
  'iso', 'basher', 'alan', 'quorra', 'radia', 'sark',
  'castor', 'able', 'beck', 'ram', 'vector', 'casp',
] as const;

export type ProgramId = typeof REGISTERED_PROGRAMS[number];

/** Check if a string is a known program ID */
export function isRegisteredProgram(id: string): id is ProgramId {
  return (REGISTERED_PROGRAMS as readonly string[]).includes(id);
}

/** Special program IDs for backward compat, mobile, and OAuth */
export const SPECIAL_PROGRAMS = ['legacy', 'mobile', 'oauth'] as const;
export type SpecialProgramId = typeof SPECIAL_PROGRAMS[number];

/** All valid program IDs including special ones */
export type ValidProgramId = ProgramId | SpecialProgramId;

export function isValidProgram(id: string): id is ValidProgramId {
  return isRegisteredProgram(id) || (SPECIAL_PROGRAMS as readonly string[]).includes(id);
}

/** Grid name → generic role mapping for backward compatibility */
export const PROGRAM_ALIASES: Record<string, ProgramId> = {
  iso: 'orchestrator',
  basher: 'builder',
  alan: 'architect',
  quorra: 'planner',
  radia: 'designer',
  sark: 'auditor',
  castor: 'scribe',
  able: 'builder',
  beck: 'builder',
  ram: 'memory',
  vector: 'strategist',
  casp: 'reviewer',
};

/** Resolve a program name to its canonical role (or itself if already canonical) */
export function resolveAlias(id: string): string {
  return PROGRAM_ALIASES[id] ?? id;
}

/** Named groups for multicast routing */
export const PROGRAM_GROUPS: Record<string, readonly ProgramId[]> = {
  council: ['orchestrator', 'architect', 'reviewer', 'auditor', 'planner', 'designer', 'strategist',
            'iso', 'alan', 'casp', 'sark', 'quorra', 'radia', 'vector'],
  builders: ['builder', 'growth', 'ops', 'basher', 'able', 'beck'],
  intelligence: ['analyzer', 'ops', 'scribe', 'alan', 'castor'],
  all: [...REGISTERED_PROGRAMS].filter(p => p !== 'council'),
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

/** Program display metadata for the portal */
export interface ProgramMeta {
  displayName: string;
  color: string;
  role: string;
}

export const PROGRAM_REGISTRY: Partial<Record<ProgramId, ProgramMeta>> = {
  orchestrator: { displayName: "Orchestrator", color: "#6FC3DF", role: "Orchestrator" },
  builder:      { displayName: "Builder",      color: "#E87040", role: "Execution Engine" },
  architect:    { displayName: "Architect",     color: "#4A8ED4", role: "Architecture" },
  reviewer:     { displayName: "Reviewer",      color: "#9B6FC0", role: "Design" },
  auditor:      { displayName: "Auditor",       color: "#C44040", role: "Audit" },
  growth:       { displayName: "Growth",        color: "#4DB870", role: "Growth" },
  ops:          { displayName: "Ops",           color: "#40A8A0", role: "Operations" },
  designer:     { displayName: "Designer",      color: "#E8E0D0", role: "Vision" },
  codex:        { displayName: "Codex",         color: "#10A37F", role: "Cross-Model Builder" },
  strategist:   { displayName: "Strategist",    color: "#C4A052", role: "Strategic Counsel" },
  // Grid program names
  iso:        { displayName: "ISO",        color: "#6FC3DF", role: "Grid Orchestrator" },
  basher:     { displayName: "BASHER",     color: "#E87040", role: "Execution Engine" },
  alan:       { displayName: "ALAN",       color: "#4A8ED4", role: "Architecture" },
  quorra:     { displayName: "QUORRA",     color: "#9B6FC0", role: "Pragmatist" },
  radia:      { displayName: "RADIA",      color: "#E8E0D0", role: "Vision & Design" },
  sark:       { displayName: "SARK",       color: "#C44040", role: "Security & Audit" },
  castor:     { displayName: "CASTOR",     color: "#B8A080", role: "Content Strategy" },
  vector:     { displayName: "VECTOR",     color: "#C4A052", role: "Strategic Counsel" },
  casp:       { displayName: "CASP",       color: "#6B8E6B", role: "Product Viability" },
};

/** Default budget caps for sessions and dreams */
export const DEFAULT_SESSION_BUDGET_USD = 20;
export const DEFAULT_DREAM_BUDGET_USD = 50;
