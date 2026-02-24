export type BillingTier = "free" | "pro" | "team";

export interface BillingLimits {
  programs: number;
  tasksPerMonth: number;
  concurrentSessions: number;
}

export interface BillingConfig {
  tier: BillingTier;
  limits: BillingLimits;
  softWarnOnly: boolean;
}

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  tier: "free",
  limits: {
    programs: 3,
    tasksPerMonth: 500,
    concurrentSessions: 1,
  },
  softWarnOnly: false,
};

export const PRO_BILLING_CONFIG: BillingConfig = {
  tier: "pro",
  limits: {
    programs: Infinity,
    tasksPerMonth: Infinity,
    concurrentSessions: 5,
  },
  softWarnOnly: true,
};

export const TEAM_BILLING_CONFIG: BillingConfig = {
  tier: "team",
  limits: {
    programs: Infinity,
    tasksPerMonth: Infinity,
    concurrentSessions: Infinity,
  },
  softWarnOnly: true,
};
