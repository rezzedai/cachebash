/**
 * OIDC JWT Validator — Verifies Google-signed OIDC tokens for /v1/internal/* endpoints.
 *
 * Cloud Scheduler sends OIDC tokens signed by Google with the scheduler SA identity.
 * This module validates the JWT signature, audience, and service account email.
 */

import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client();

/** Expected scheduler service account email (set via env or default) */
const SCHEDULER_SA_EMAIL =
  process.env.SCHEDULER_SA_EMAIL ||
  `cachebash-scheduler@${process.env.GCP_PROJECT_ID || "cachebash-app"}.iam.gserviceaccount.com`;

/** Expected audience — the Cloud Run service URL */
const EXPECTED_AUDIENCE =
  process.env.INTERNAL_OIDC_AUDIENCE ||
  process.env.CLOUD_RUN_URL ||
  "https://api.cachebash.dev";

/**
 * Validate an OIDC token from Cloud Scheduler.
 * Returns the verified email on success, null on failure.
 */
export async function validateOidcToken(token: string): Promise<string | null> {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: EXPECTED_AUDIENCE,
    });

    const payload = ticket.getPayload();
    if (!payload) return null;

    // Verify the token came from the expected service account
    if (payload.email !== SCHEDULER_SA_EMAIL) {
      console.warn(
        `[OIDC] Rejected: email=${payload.email} expected=${SCHEDULER_SA_EMAIL}`
      );
      return null;
    }

    // Verify email is verified (Google SA tokens always have this, but defense-in-depth)
    if (!payload.email_verified) {
      console.warn(`[OIDC] Rejected: email not verified for ${payload.email}`);
      return null;
    }

    return payload.email;
  } catch (err) {
    console.error("[OIDC] Token verification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
