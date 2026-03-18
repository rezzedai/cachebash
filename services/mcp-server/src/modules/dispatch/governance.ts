/**
 * Governance Pre-flight — Constitutional rule enforcement for dispatch.
 *
 * Implements SOFT checks (warn, don't block) per ALAN's recommendation:
 * "5 rules WITH enforcement, not 15 without."
 *
 * Checks run before task creation in the dispatch handler. Warnings are
 * included in the DispatchResponse.governance_warnings field.
 */

import { getFirestore } from "../../firebase/client.js";

// ─── CONSTITUTIONAL RULE DEFINITIONS ────────────────────────────────────────
// Canonical source for seeding via gsp_seed and runtime checking.

export interface ConstitutionalRule {
  key: string;
  description: string;
  tier: "constitutional";
  value: {
    rule: string;
    enforcement: string;
    violation_severity: "P0" | "P1" | "P2";
  };
}

export const CONSTITUTIONAL_RULES: ConstitutionalRule[] = [
  {
    key: "flynn-gate",
    tier: "constitutional",
    description: "Strategic decisions require Flynn's approval. Programs handle ops autonomously.",
    value: {
      rule: "Strategic decisions (roadmap, priorities, new projects, capital allocation) require Flynn's approval. Programs handle ops autonomously.",
      enforcement: "Dispatch pre-flight checks for strategic keywords in instructions. Escalation chain enforced: Workers → ISO, ISO → VECTOR, VECTOR → Flynn.",
      violation_severity: "P0",
    },
  },
  {
    key: "no-destructive-git",
    tier: "constitutional",
    description: "No destructive git operations without explicit human authorization.",
    value: {
      rule: "No force-push, reset --hard, branch -D, or checkout . without explicit human authorization. Safety-critical.",
      enforcement: "Dispatch pre-flight scans instructions for destructive git patterns. Warns on match. CI/CD hooks reject force-push to protected branches.",
      violation_severity: "P0",
    },
  },
  {
    key: "pr-based-changes",
    tier: "constitutional",
    description: "All code changes to production branches go through pull requests.",
    value: {
      rule: "All code changes to production branches go through pull requests. No direct commits to main.",
      enforcement: "Branch protection rules on main/production. Dispatch pre-flight warns if instructions suggest direct commits.",
      violation_severity: "P1",
    },
  },
  {
    key: "budget-caps",
    tier: "constitutional",
    description: "Autonomous operations must have explicit budget caps.",
    value: {
      rule: "Autonomous operations (dream runs, sprints) must have explicit budget caps. No unbounded execution.",
      enforcement: "Dispatch pre-flight checks dream/sprint actions for budget cap presence. Warns if missing.",
      violation_severity: "P1",
    },
  },
  {
    key: "escalation-required",
    tier: "constitutional",
    description: "Escalate when uncertainty exceeds program capability.",
    value: {
      rule: "When uncertainty exceeds program capability, escalate up the chain. Workers → ISO, ISO → VECTOR, VECTOR → Flynn. Never guess on high-stakes decisions.",
      enforcement: "Monitored via task completion patterns. Programs with repeated failures without escalation flagged in health checks.",
      violation_severity: "P2",
    },
  },
];

// ─── DESTRUCTIVE GIT PATTERNS ───────────────────────────────────────────────

const DESTRUCTIVE_GIT_PATTERNS: RegExp[] = [
  /\bforce[\s-]*push\b/i,
  /\bpush\s+--force\b/i,
  /\bpush\s+-f\b/i,
  /\breset\s+--hard\b/i,
  /\bbranch\s+-[dD]\b/i,
  /\bcheckout\s+\./i,
  /\bclean\s+-f\b/i,
  /--no-verify\b/i,
];

// ─── DIRECT COMMIT PATTERNS ────────────────────────────────────────────────

const DIRECT_COMMIT_PATTERNS: RegExp[] = [
  /\bcommit\s+(directly\s+)?to\s+main\b/i,
  /\bpush\s+(directly\s+)?to\s+main\b/i,
  /\bcommit\s+(directly\s+)?to\s+master\b/i,
  /\bpush\s+(directly\s+)?to\s+master\b/i,
  /\bno\s+pr\b/i,
  /\bskip\s+(the\s+)?pull\s+request\b/i,
  /\bwithout\s+(a\s+)?pr\b/i,
];

// ─── BUDGET-RELATED PATTERNS ────────────────────────────────────────────────

const BUDGET_KEYWORDS: RegExp[] = [
  /\bbudget\b/i,
  /\bcost[\s_-]?(cap|limit|max)\b/i,
  /\bmax[\s_-]?(cost|spend|budget|tokens?)\b/i,
  /\btoken[\s_-]?(limit|cap|budget)\b/i,
  /\b\$\d+/,
];

// ─── GOVERNANCE CHECK ───────────────────────────────────────────────────────

export interface GovernanceCheckResult {
  warnings: string[];
  rules_checked: number;
}

/**
 * Run governance pre-flight checks against dispatch arguments.
 * Returns warnings (soft enforcement — never blocks dispatch).
 */
export function checkGovernanceRules(args: {
  instructions?: string;
  action?: string;
  title?: string;
}): GovernanceCheckResult {
  const warnings: string[] = [];
  const text = [args.instructions || "", args.title || ""].join(" ");
  let rulesChecked = 0;

  // ── Rule: no-destructive-git ──
  rulesChecked++;
  for (const pattern of DESTRUCTIVE_GIT_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(
        `[no-destructive-git] Instructions contain destructive git operation matching "${pattern.source}". Constitutional rule requires explicit human authorization for force-push, reset --hard, branch -D, checkout ., and similar operations.`
      );
      break; // One warning per rule is enough
    }
  }

  // ── Rule: pr-based-changes ──
  rulesChecked++;
  for (const pattern of DIRECT_COMMIT_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(
        `[pr-based-changes] Instructions suggest direct commits to production branch. Constitutional rule requires all code changes go through pull requests.`
      );
      break;
    }
  }

  // ── Rule: budget-caps ──
  rulesChecked++;
  const isDreamOrSprint = args.action === "sprint" || args.action === "parallel";
  const titleSuggestsDream = /\b(dream|sprint)\b/i.test(args.title || "");
  const instructionsSuggestDream = /\b(dream\s+run|sprint|unbounded|long[\s-]running)\b/i.test(args.instructions || "");

  if (isDreamOrSprint || titleSuggestsDream || instructionsSuggestDream) {
    const hasBudgetRef = BUDGET_KEYWORDS.some((p) => p.test(text));
    if (!hasBudgetRef) {
      warnings.push(
        `[budget-caps] Dispatch appears to be a dream/sprint operation but no budget cap detected in instructions. Constitutional rule requires explicit budget caps for autonomous operations.`
      );
    }
  }

  return { warnings, rules_checked: rulesChecked };
}

// ─── GSP SEED HELPER ────────────────────────────────────────────────────────

/**
 * Returns the constitutional rules formatted for gsp_seed.
 * Used by the seed script and verifiable via gsp_read.
 */
export function getConstitutionalSeedEntries(): Array<{
  key: string;
  value: ConstitutionalRule["value"];
  tier: "constitutional";
  description: string;
}> {
  return CONSTITUTIONAL_RULES.map((r) => ({
    key: r.key,
    value: r.value,
    tier: r.tier,
    description: r.description,
  }));
}
