import { computeAndApply } from "./decayProgramState";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-01T00:00:00Z");

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

function baseState(overrides: any = {}) {
  return {
    programId: "basher",
    lastUpdatedAt: iso(1),
    contextSummary: { lastTask: null, activeWorkItems: [], handoffNotes: "", openQuestions: [] },
    learnedPatterns: [],
    baselines: {
      avgTaskDurationMinutes: null,
      lastSessionDurationMinutes: null,
      commonFailureModes: [],
      sessionsCompleted: 3,
    },
    decay: {
      contextSummaryTTLDays: 7,
      learnedPatternMaxAge: 30,
      maxUnpromotedPatterns: 50,
      lastDecayRun: iso(2),
      decayLog: [],
    },
    ...overrides,
  };
}

function lp(overrides: any = {}) {
  return {
    id: "p1",
    domain: "dev",
    pattern: "some pattern",
    confidence: 0.5,
    evidence: "e",
    discoveredAt: iso(60),
    lastReinforced: iso(60),
    promotedToStore: false,
    stale: false,
    ...overrides,
  };
}

describe("computeAndApply — typed decayLog actions", () => {
  it("stales an unreinforced pattern past max age with a pattern_staled action", () => {
    const state = baseState({ learnedPatterns: [lp({ lastReinforced: iso(45) })] });
    const { actions, counts } = computeAndApply(state, NOW, false);
    expect(counts.pattern_staled).toBe(1);
    expect(actions[0].action).toBe("pattern_staled");
    expect(actions[0]).toHaveProperty("timestamp");
    expect(actions[0]).toHaveProperty("detail");
  });

  it("clears a completed context summary past TTL with context_cleared", () => {
    const state = baseState({
      lastUpdatedAt: iso(10),
      contextSummary: {
        lastTask: { taskId: "t1", title: "x", outcome: "completed", notes: "" },
        activeWorkItems: [],
        handoffNotes: "",
        openQuestions: [],
      },
    });
    const { counts } = computeAndApply(state, NOW, false);
    expect(counts.context_cleared).toBe(1);
  });

  it("evicts unpromoted patterns over the cap with pattern_evicted, weakest first", () => {
    const patterns = Array.from({ length: 4 }, (_, i) =>
      lp({ id: `p${i}`, confidence: 0.1 * (i + 1), lastReinforced: iso(1) })
    );
    const state = baseState({
      learnedPatterns: patterns,
      decay: { ...baseState().decay, maxUnpromotedPatterns: 2 },
    });
    const { counts, actions } = computeAndApply(state, NOW, false);
    expect(counts.pattern_evicted).toBe(2);
    // lowest confidence (p0, p1) evicted first
    expect(actions.filter((a) => a.action === "pattern_evicted").map((a) => a.detail).join(" ")).toContain("p0");
  });
});

describe("computeAndApply — DRY_RUN does not mutate", () => {
  it("records actions but leaves pattern.stale untouched in dry-run", () => {
    const state = baseState({ learnedPatterns: [lp({ lastReinforced: iso(45) })] });
    const { counts } = computeAndApply(state, NOW, true);
    expect(counts.pattern_staled).toBe(1);
    expect(state.learnedPatterns[0].stale).toBe(false); // NOT mutated
  });

  it("mutates pattern.stale when dryRun is false", () => {
    const state = baseState({ learnedPatterns: [lp({ lastReinforced: iso(45) })] });
    computeAndApply(state, NOW, false);
    expect(state.learnedPatterns[0].stale).toBe(true);
  });

  it("does not clear context in dry-run", () => {
    const state = baseState({
      lastUpdatedAt: iso(10),
      contextSummary: {
        lastTask: { taskId: "t1", title: "x", outcome: "completed", notes: "" },
        activeWorkItems: [],
        handoffNotes: "keep me",
        openQuestions: [],
      },
    });
    computeAndApply(state, NOW, true);
    expect(state.contextSummary.lastTask).not.toBeNull();
    expect(state.contextSummary.handoffNotes).toBe("keep me");
  });
});

describe("computeAndApply — grace window (promotion before eviction)", () => {
  it("never stales a pattern that meets promotion criteria", () => {
    // confidence >= 0.8, reinforced, but aged past max-age — must be spared.
    const promotable = lp({
      confidence: 0.9,
      discoveredAt: iso(60),
      lastReinforced: iso(45),
    });
    const state = baseState({ learnedPatterns: [promotable] });
    const { counts } = computeAndApply(state, NOW, false);
    expect(counts.pattern_staled).toBe(0);
    expect(state.learnedPatterns[0].stale).toBe(false);
  });

  it("excludes promotable patterns from the eviction cap candidate set", () => {
    const promotable = lp({ id: "keep", confidence: 0.9, lastReinforced: iso(1) });
    const weak = Array.from({ length: 3 }, (_, i) =>
      lp({ id: `w${i}`, confidence: 0.2, lastReinforced: iso(1) })
    );
    const state = baseState({
      learnedPatterns: [promotable, ...weak],
      decay: { ...baseState().decay, maxUnpromotedPatterns: 2 },
    });
    const { actions } = computeAndApply(state, NOW, false);
    const evicted = actions.filter((a) => a.action === "pattern_evicted").map((a) => a.detail).join(" ");
    expect(evicted).not.toContain("'keep'");
  });
});
