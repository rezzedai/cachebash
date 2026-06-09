import {
  isPromotable,
  evaluatePromotion,
  findDuplicate,
  LearnedPattern,
} from "./onProgramStateWrite";

function pattern(overrides: Partial<LearnedPattern> = {}): LearnedPattern {
  return {
    id: "p1",
    domain: "auth",
    pattern: "Use Firestore transactions for concurrent token refresh",
    confidence: 0.9,
    evidence: "observed during oauth work",
    discoveredAt: "2026-01-01T00:00:00Z",
    lastReinforced: "2026-01-05T00:00:00Z",
    promotedToStore: false,
    stale: false,
    ...overrides,
  };
}

describe("isPromotable", () => {
  it("promotes at confidence >= 0.8 when reinforced and not stale/promoted", () => {
    expect(isPromotable(pattern({ confidence: 0.8 }))).toBe(true);
    expect(isPromotable(pattern({ confidence: 0.95 }))).toBe(true);
  });

  it("rejects below the 0.8 threshold (0.7 no longer qualifies)", () => {
    expect(isPromotable(pattern({ confidence: 0.7 }))).toBe(false);
    expect(isPromotable(pattern({ confidence: 0.79 }))).toBe(false);
  });

  it("requires at least one reinforcement", () => {
    const t = "2026-01-01T00:00:00Z";
    expect(isPromotable(pattern({ discoveredAt: t, lastReinforced: t }))).toBe(false);
  });

  it("rejects stale or already-promoted patterns", () => {
    expect(isPromotable(pattern({ stale: true }))).toBe(false);
    expect(isPromotable(pattern({ promotedToStore: true }))).toBe(false);
  });
});

describe("evaluatePromotion", () => {
  it("selects eligible patterns and emits promotedToStore field updates", () => {
    const after = [pattern({ id: "a", confidence: 0.85 }), pattern({ id: "b", confidence: 0.5 })];
    const { toPromote, updates } = evaluatePromotion([], after);
    expect(toPromote.map((p) => p.id)).toEqual(["a"]);
    expect(updates).toEqual({ "learnedPatterns.0.promotedToStore": true });
  });

  it("does not re-trigger patterns already promoted in the before state", () => {
    const before = [pattern({ id: "a", promotedToStore: true })];
    const after = [pattern({ id: "a", promotedToStore: true, confidence: 0.9 })];
    const { toPromote } = evaluatePromotion(before, after);
    expect(toPromote).toHaveLength(0);
  });
});

describe("findDuplicate", () => {
  const candidate = pattern({ id: "new", domain: "auth" });

  it("flags a promoted cross-program pattern with similar text in the same domain", () => {
    const dup = findDuplicate(candidate, [
      {
        programId: "gem",
        patterns: [
          pattern({
            id: "gem-1",
            domain: "auth",
            promotedToStore: true,
            pattern: "Use Firestore transactions for concurrent token refresh races",
          }),
        ],
      },
    ]);
    expect(dup).toEqual({ programId: "gem", patternId: "gem-1" });
  });

  it("ignores unpromoted patterns and different domains", () => {
    expect(
      findDuplicate(candidate, [
        { programId: "gem", patterns: [pattern({ promotedToStore: false })] },
      ])
    ).toBeNull();
    expect(
      findDuplicate(candidate, [
        { programId: "gem", patterns: [pattern({ domain: "deployment", promotedToStore: true })] },
      ])
    ).toBeNull();
  });

  it("returns null when no similar pattern exists", () => {
    expect(
      findDuplicate(candidate, [
        {
          programId: "gem",
          patterns: [
            pattern({ domain: "auth", promotedToStore: true, pattern: "Cache DNS lookups aggressively" }),
          ],
        },
      ])
    ).toBeNull();
  });
});
