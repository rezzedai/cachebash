import {
  validateTransition,
  transition,
  LifecycleError,
  TRANSITIONS,
  LifecycleStatus,
  EntityType,
} from "../lifecycle/engine";

const ALL_STATUSES: LifecycleStatus[] = [
  "created",
  "active",
  "blocked",
  "completing",
  "done",
  "failed",
  "derezzed",
];

const ALL_ENTITY_TYPES: EntityType[] = ["task", "session", "dream", "sprint-story"];

describe("Lifecycle Engine", () => {
  describe("validateTransition", () => {
    describe("task transitions", () => {
      const valid: [LifecycleStatus, LifecycleStatus][] = [
        ["created", "active"],
        ["created", "failed"],
        ["created", "derezzed"],
        ["active", "blocked"],
        ["active", "completing"],
        ["active", "done"],
        ["active", "failed"],
        ["blocked", "active"],
        ["blocked", "failed"],
        ["blocked", "derezzed"],
        ["completing", "done"],
        ["completing", "failed"],
        ["done", "derezzed"],
        ["failed", "created"],
        ["failed", "derezzed"],
      ];

      it.each(valid)("allows %s → %s", (from, to) => {
        expect(validateTransition("task", from, to)).toBe(true);
      });

      const invalid: [LifecycleStatus, LifecycleStatus][] = [
        ["created", "blocked"],
        ["created", "completing"],
        ["created", "done"],
        ["active", "created"],
        ["blocked", "completing"],
        ["blocked", "done"],
        ["completing", "created"],
        ["completing", "active"],
        ["completing", "blocked"],
        ["done", "created"],
        ["done", "active"],
        ["done", "failed"],
        ["failed", "active"],
        ["failed", "blocked"],
        ["derezzed", "created"],
        ["derezzed", "active"],
        ["derezzed", "failed"],
      ];

      it.each(invalid)("rejects %s → %s", (from, to) => {
        expect(validateTransition("task", from, to)).toBe(false);
      });
    });

    describe("session transitions", () => {
      const valid: [LifecycleStatus, LifecycleStatus][] = [
        ["created", "active"],
        ["active", "blocked"],
        ["active", "done"],
        ["active", "failed"],
        ["blocked", "active"],
        ["blocked", "failed"],
        ["done", "derezzed"],
        ["failed", "derezzed"],
      ];

      it.each(valid)("allows %s → %s", (from, to) => {
        expect(validateTransition("session", from, to)).toBe(true);
      });

      it("rejects sessions entering completing", () => {
        expect(validateTransition("session", "active", "completing")).toBe(false);
      });

      it("rejects sessions starting from completing", () => {
        // completing has no valid transitions for sessions
        for (const to of ALL_STATUSES) {
          expect(validateTransition("session", "completing", to)).toBe(false);
        }
      });
    });

    describe("dream transitions", () => {
      const valid: [LifecycleStatus, LifecycleStatus][] = [
        ["created", "active"],
        ["created", "failed"],
        ["active", "completing"],
        ["active", "done"],
        ["active", "failed"],
        ["completing", "done"],
        ["completing", "failed"],
        ["done", "derezzed"],
        ["failed", "derezzed"],
      ];

      it.each(valid)("allows %s → %s", (from, to) => {
        expect(validateTransition("dream", from, to)).toBe(true);
      });

      it("rejects dreams entering blocked", () => {
        // Dreams don't block — they fail
        for (const from of ALL_STATUSES) {
          if (from === "blocked") continue; // skip testing from blocked
          expect(validateTransition("dream", from, "blocked")).toBe(false);
        }
      });

      it("rejects transitions from blocked", () => {
        for (const to of ALL_STATUSES) {
          expect(validateTransition("dream", "blocked", to)).toBe(false);
        }
      });
    });

    describe("sprint-story transitions", () => {
      const valid: [LifecycleStatus, LifecycleStatus][] = [
        ["created", "active"],
        ["created", "blocked"],
        ["created", "failed"],
        ["active", "blocked"],
        ["active", "completing"],
        ["active", "done"],
        ["active", "failed"],
        ["blocked", "active"],
        ["blocked", "failed"],
        ["completing", "done"],
        ["completing", "failed"],
        ["done", "derezzed"],
        ["failed", "created"],
        ["failed", "derezzed"],
      ];

      it.each(valid)("allows %s → %s", (from, to) => {
        expect(validateTransition("sprint-story", from, to)).toBe(true);
      });
    });

    it("returns false for unknown entity type", () => {
      expect(validateTransition("unknown" as EntityType, "created", "active")).toBe(false);
    });
  });

  describe("transition", () => {
    it("returns the target status on valid transition", () => {
      expect(transition("task", "created", "active")).toBe("active");
      expect(transition("task", "active", "done")).toBe("done");
      expect(transition("dream", "active", "completing")).toBe("completing");
    });

    it("throws LifecycleError on invalid transition", () => {
      expect(() => transition("task", "done", "active")).toThrow(LifecycleError);
      expect(() => transition("session", "completing", "done")).toThrow(LifecycleError);
      expect(() => transition("dream", "blocked", "active")).toThrow(LifecycleError);
    });

    it("throws LifecycleError for unknown entity type", () => {
      expect(() => transition("bogus" as EntityType, "created", "active")).toThrow(LifecycleError);
    });

    it("includes context in LifecycleError", () => {
      try {
        transition("task", "done", "created");
        fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleError);
        const le = err as LifecycleError;
        expect(le.entityType).toBe("task");
        expect(le.from).toBe("done");
        expect(le.to).toBe("created");
        expect(le.message).toContain("done");
        expect(le.message).toContain("created");
      }
    });
  });

  describe("derezzed is terminal for all entity types", () => {
    it.each(ALL_ENTITY_TYPES)("%s: derezzed has no outbound transitions", (entityType) => {
      for (const to of ALL_STATUSES) {
        expect(validateTransition(entityType, "derezzed", to)).toBe(false);
      }
    });
  });

  describe("TRANSITIONS completeness", () => {
    it.each(ALL_ENTITY_TYPES)("%s: every status has a transition entry", (entityType) => {
      const entityTransitions = TRANSITIONS[entityType];
      for (const status of ALL_STATUSES) {
        expect(entityTransitions).toHaveProperty(status);
        expect(Array.isArray(entityTransitions[status])).toBe(true);
      }
    });

    it.each(ALL_ENTITY_TYPES)("%s: all transition targets are valid statuses", (entityType) => {
      const entityTransitions = TRANSITIONS[entityType];
      for (const [, targets] of Object.entries(entityTransitions)) {
        for (const target of targets) {
          expect(ALL_STATUSES).toContain(target);
        }
      }
    });
  });

  describe("retry paths", () => {
    it("tasks can retry: failed → created → active", () => {
      const s1 = transition("task", "failed", "created");
      const s2 = transition("task", s1, "active");
      expect(s2).toBe("active");
    });

    it("sprint-stories can retry: failed → created → active", () => {
      const s1 = transition("sprint-story", "failed", "created");
      const s2 = transition("sprint-story", s1, "active");
      expect(s2).toBe("active");
    });

    it("dreams cannot retry: failed has no path to created", () => {
      expect(validateTransition("dream", "failed", "created")).toBe(false);
    });

    it("sessions cannot retry: failed has no path to created", () => {
      expect(validateTransition("session", "failed", "created")).toBe(false);
    });
  });
});
