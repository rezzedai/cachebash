/**
 * Lifecycle Engine — The unified state machine for the Grid.
 *
 * Every entity on the Grid follows the same lifecycle:
 *   created → active → completing → done → derezzed
 *
 * With branches for failure and blocking:
 *   active → blocked → active (unblocked)
 *   any → failed → created (retry) or derezzed (give up)
 *
 * The engine validates transitions and throws on illegal moves.
 * No entity changes status without going through this gate.
 */

/** The seven lifecycle states */
export type LifecycleStatus =
  | "created"
  | "active"
  | "blocked"
  | "completing"
  | "done"
  | "failed"
  | "derezzed";

/** Entity types that have lifecycle rules */
export type EntityType = "task" | "session" | "dream" | "sprint-story";

/** Valid transitions per entity type */
export const TRANSITIONS: Record<EntityType, Record<LifecycleStatus, LifecycleStatus[]>> = {
  task: {
    created: ["active", "failed", "derezzed"],
    active: ["blocked", "completing", "done", "failed"],
    blocked: ["active", "failed", "derezzed"],
    completing: ["done", "failed"],
    done: ["derezzed"],
    failed: ["created", "derezzed"],
    derezzed: [],
  },
  session: {
    created: ["active"],
    active: ["blocked", "done", "failed"],
    blocked: ["active", "failed"],
    completing: [],
    done: ["derezzed"],
    failed: ["derezzed"],
    derezzed: [],
  },
  dream: {
    created: ["active", "failed"],
    active: ["completing", "done", "failed"],
    blocked: [],
    completing: ["done", "failed"],
    done: ["derezzed"],
    failed: ["derezzed"],
    derezzed: [],
  },
  "sprint-story": {
    created: ["active", "blocked", "failed"],
    active: ["blocked", "completing", "done", "failed"],
    blocked: ["active", "failed"],
    completing: ["done", "failed"],
    done: ["derezzed"],
    failed: ["created", "derezzed"],
    derezzed: [],
  },
};

/**
 * Check if a transition is valid for the given entity type.
 */
export function validateTransition(
  entityType: EntityType,
  from: LifecycleStatus,
  to: LifecycleStatus,
): boolean {
  const entityTransitions = TRANSITIONS[entityType];
  if (!entityTransitions) return false;

  const allowed = entityTransitions[from];
  if (!allowed) return false;

  return allowed.includes(to);
}

/**
 * Perform a lifecycle transition. Returns the new status.
 * Throws if the transition is invalid.
 */
export function transition(
  entityType: EntityType,
  current: LifecycleStatus,
  target: LifecycleStatus,
): LifecycleStatus {
  if (!TRANSITIONS[entityType]) {
    throw new LifecycleError(
      `Unknown entity type: ${entityType}`,
      entityType,
      current,
      target,
    );
  }

  if (!validateTransition(entityType, current, target)) {
    throw new LifecycleError(
      `Invalid transition for ${entityType}: ${current} → ${target}`,
      entityType,
      current,
      target,
    );
  }

  return target;
}

/**
 * Error thrown when a lifecycle transition is invalid.
 */
export class LifecycleError extends Error {
  readonly entityType: EntityType | string;
  readonly from: LifecycleStatus;
  readonly to: LifecycleStatus;

  constructor(
    message: string,
    entityType: EntityType | string,
    from: LifecycleStatus,
    to: LifecycleStatus,
  ) {
    super(message);
    this.name = "LifecycleError";
    this.entityType = entityType;
    this.from = from;
    this.to = to;
  }
}
