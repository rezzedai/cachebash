/**
 * Compliance Configuration — W1.2 Compliance Gates
 *
 * Tenant-level compliance settings for session ID validation,
 * derez gates, ACK auditing, and other governance controls.
 */

export interface ComplianceConfig {
  /** W1.2.1: Session ID format validation */
  sessionIdValidation: {
    /** Enforce strict {program}[-{env}].{task} format */
    enforceFormat: boolean;
    /** Allow legacy format (warn but don't reject) */
    allowLegacy: boolean;
  };

  /** W1.2.2: Derez gate — pattern extraction check */
  derezGate: {
    /** "lenient" logs warning, "strict" blocks completion */
    mode: "lenient" | "strict";
    /** Require learnedPatterns update before session completion */
    requirePatternExtraction: boolean;
  };

  /** W1.2.3: ACK audit trail */
  ackAudit: {
    /** Track DIRECTIVE messages and ACK responses */
    enabled: boolean;
    /** Retention period in days */
    retentionDays: number;
  };

  /** W1.2.4: Idempotency key enforcement */
  idempotencyKey: {
    /** "required" rejects without key, "recommended" logs warning */
    enforcement: "required" | "recommended" | "optional";
  };

  /** W1.2.5: Context health reporting */
  contextHealth: {
    /** Enable context staleness detection */
    enabled: boolean;
    /** Session is stale if no update for this many minutes */
    stalenessThresholdMinutes: number;
  };

  /** W1.2.6: Rate limiting per tenant */
  rateLimits: {
    /** Enable tenant-level rate limiting */
    enabled: boolean;
    /** Requests per minute per endpoint */
    requestsPerMinute: Record<string, number>;
  };
}

/** Default compliance config (permissive for backwards compatibility) */
export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  sessionIdValidation: {
    enforceFormat: false,
    allowLegacy: true,
  },
  derezGate: {
    mode: "lenient",
    requirePatternExtraction: false,
  },
  ackAudit: {
    enabled: true,
    retentionDays: 90,
  },
  idempotencyKey: {
    enforcement: "recommended",
  },
  contextHealth: {
    enabled: true,
    stalenessThresholdMinutes: 30,
  },
  rateLimits: {
    enabled: false,
    requestsPerMinute: {
      create_session: 60,
      update_session: 120,
      send_message: 60,
      create_task: 30,
    },
  },
};

/** Session ID validation regex: {program}[-{env}].{task} */
export const SESSION_ID_REGEX = /^([a-zA-Z0-9_-]+)(?:-([a-zA-Z0-9_-]+))?\.([a-zA-Z0-9_-]+)$/;

/**
 * Validate session ID format.
 * Returns { valid: boolean, legacy: boolean, reason?: string }
 */
export function validateSessionId(sessionId: string): {
  valid: boolean;
  legacy: boolean;
  reason?: string;
} {
  // Allow some legacy formats
  const legacyPatterns = [
    /^session_\d+$/, // session_1234567890
    /^[a-zA-Z0-9_-]+$/, // simple alphanumeric
  ];

  // Check strict format first
  if (SESSION_ID_REGEX.test(sessionId)) {
    return { valid: true, legacy: false };
  }

  // Check legacy patterns
  for (const pattern of legacyPatterns) {
    if (pattern.test(sessionId)) {
      return { valid: true, legacy: true };
    }
  }

  return {
    valid: false,
    legacy: false,
    reason: `Session ID must match pattern: {program}[-{env}].{task} (e.g., "basher.task123" or "basher-prod.task123")`,
  };
}

/**
 * Get compliance config for a tenant.
 * For now, returns default config. In the future, this could be fetched from Firestore.
 */
export function getComplianceConfig(_userId: string): ComplianceConfig {
  return DEFAULT_COMPLIANCE_CONFIG;
}
