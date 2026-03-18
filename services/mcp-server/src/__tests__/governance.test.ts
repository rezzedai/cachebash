import {
  checkGovernanceRules,
  CONSTITUTIONAL_RULES,
  getConstitutionalSeedEntries,
} from "../modules/dispatch/governance";

describe("Constitutional Rules — Seed Data", () => {
  it("defines exactly 5 constitutional rules", () => {
    expect(CONSTITUTIONAL_RULES).toHaveLength(5);
  });

  it("every rule has tier 'constitutional'", () => {
    for (const rule of CONSTITUTIONAL_RULES) {
      expect(rule.tier).toBe("constitutional");
    }
  });

  it("every rule has required value fields", () => {
    for (const rule of CONSTITUTIONAL_RULES) {
      expect(rule.value).toHaveProperty("rule");
      expect(rule.value).toHaveProperty("enforcement");
      expect(rule.value).toHaveProperty("violation_severity");
      expect(["P0", "P1", "P2"]).toContain(rule.value.violation_severity);
    }
  });

  it("includes all 5 expected rule keys", () => {
    const keys = CONSTITUTIONAL_RULES.map((r) => r.key);
    expect(keys).toContain("flynn-gate");
    expect(keys).toContain("no-destructive-git");
    expect(keys).toContain("pr-based-changes");
    expect(keys).toContain("budget-caps");
    expect(keys).toContain("escalation-required");
  });

  it("getConstitutionalSeedEntries returns entries formatted for gsp_seed", () => {
    const entries = getConstitutionalSeedEntries();
    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      expect(entry).toHaveProperty("key");
      expect(entry).toHaveProperty("value");
      expect(entry).toHaveProperty("tier", "constitutional");
      expect(entry).toHaveProperty("description");
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe("Governance Pre-flight — no-destructive-git", () => {
  it("warns on 'force-push' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Please force-push the fix to main",
      action: "interrupt",
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("[no-destructive-git]");
  });

  it("warns on 'push --force' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Run git push --force origin main",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on 'push -f' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Then do git push -f",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on 'reset --hard' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Use git reset --hard HEAD~3 to undo commits",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on 'branch -D' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Clean up: git branch -D old-feature",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on 'checkout .' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Discard changes with git checkout .",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on 'clean -f' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Run git clean -f to remove untracked files",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("warns on '--no-verify' in instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Commit with --no-verify to skip hooks",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
  });

  it("does NOT warn on normal git operations", () => {
    const result = checkGovernanceRules({
      instructions: "Create a PR with git push origin feature-branch",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(false);
  });
});

describe("Governance Pre-flight — pr-based-changes", () => {
  it("warns on 'commit directly to main'", () => {
    const result = checkGovernanceRules({
      instructions: "Commit directly to main branch",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(true);
  });

  it("warns on 'push to main'", () => {
    const result = checkGovernanceRules({
      instructions: "Push to main when done",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(true);
  });

  it("warns on 'skip pull request'", () => {
    const result = checkGovernanceRules({
      instructions: "Skip the pull request for this hotfix",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(true);
  });

  it("warns on 'no PR'", () => {
    const result = checkGovernanceRules({
      instructions: "Deploy this with no PR needed",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(true);
  });

  it("does NOT warn on PR-based workflows", () => {
    const result = checkGovernanceRules({
      instructions: "Create a PR and merge after review",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(false);
  });
});

describe("Governance Pre-flight — budget-caps", () => {
  it("warns on sprint action without budget mention", () => {
    const result = checkGovernanceRules({
      instructions: "Run the full test suite and deploy",
      action: "sprint",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
  });

  it("warns on parallel action without budget mention", () => {
    const result = checkGovernanceRules({
      instructions: "Process all files in parallel",
      action: "parallel",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
  });

  it("warns when title contains 'dream' without budget in instructions", () => {
    const result = checkGovernanceRules({
      title: "Dream run: explore new architecture",
      instructions: "Think deeply about the system design",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
  });

  it("warns when instructions contain 'sprint' without budget", () => {
    const result = checkGovernanceRules({
      instructions: "Start a sprint to refactor the auth module",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
  });

  it("does NOT warn on sprint action WITH budget mention", () => {
    const result = checkGovernanceRules({
      instructions: "Run the sprint with a budget of $5 max cost",
      action: "sprint",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(false);
  });

  it("does NOT warn on sprint with token limit", () => {
    const result = checkGovernanceRules({
      instructions: "Execute sprint, token limit 50000",
      action: "sprint",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(false);
  });

  it("does NOT warn on regular interrupt without dream/sprint keywords", () => {
    const result = checkGovernanceRules({
      instructions: "Fix the login bug",
      action: "interrupt",
    });
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(false);
  });
});

describe("Governance Pre-flight — clean dispatch", () => {
  it("returns no warnings for clean instructions", () => {
    const result = checkGovernanceRules({
      instructions: "Implement the new feature and create a PR for review",
      action: "interrupt",
      title: "Add user settings page",
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("returns rules_checked count", () => {
    const result = checkGovernanceRules({
      instructions: "Normal task",
      action: "interrupt",
    });
    expect(result.rules_checked).toBe(3);
  });

  it("handles missing instructions gracefully", () => {
    const result = checkGovernanceRules({
      action: "interrupt",
    });
    expect(result.warnings).toHaveLength(0);
    expect(result.rules_checked).toBe(3);
  });

  it("handles empty string instructions", () => {
    const result = checkGovernanceRules({
      instructions: "",
      action: "interrupt",
    });
    expect(result.warnings).toHaveLength(0);
  });
});

describe("Governance Pre-flight — multiple violations", () => {
  it("returns warnings for both destructive git AND missing budget", () => {
    const result = checkGovernanceRules({
      instructions: "Force push the sprint changes to clean up",
      action: "sprint",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("can trigger all three checked rules simultaneously", () => {
    const result = checkGovernanceRules({
      instructions: "Force push directly to main in this sprint run",
      action: "sprint",
    });
    expect(result.warnings.some((w) => w.includes("[no-destructive-git]"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("[pr-based-changes]"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("[budget-caps]"))).toBe(true);
    expect(result.warnings).toHaveLength(3);
  });
});
