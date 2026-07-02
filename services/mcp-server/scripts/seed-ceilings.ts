/**
 * seed-ceilings.ts — Idempotent seed/update of a tenant's WS-3 circuit
 * breaker ceilings doc: tenants/{org}/_meta/ceilings.
 *
 * ── Why this has to run before WS-3 goes live ─────────────────────────────
 * middleware/circuitBreaker.ts is FAIL-CLOSED: any tenant with no ceilings
 * doc has ALL mutating tool calls denied (dispatch writes, relay sends,
 * state writes, ...). That's the correct security posture (SARK #881
 * finding 5 — never fail open on a boundary control) but it means every
 * tenant that needs to keep mutating — every existing Grid program tenant
 * included — must have this doc seeded BEFORE the breaker's enforcement
 * code is deployed live, not after.
 *
 * ── Credential ─────────────────────────────────────────────────────────
 *   gcloud auth application-default login   # once, as an owner
 *   (same ADC requirement as provision-program.ts — grid-deployer SA is
 *   Firestore read-only in prod and will 403 on the write.)
 *
 * ── Run ────────────────────────────────────────────────────────────────
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx \
 *     services/mcp-server/scripts/seed-ceilings.ts lore
 *
 *   # override defaults:
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx \
 *     services/mcp-server/scripts/seed-ceilings.ts lore \
 *     '{"perKeyLimit":50,"orgLimit":300,"windowMs":60000}'
 *
 * Idempotent: merges into the existing doc rather than clobbering it, so
 * re-running to bump a limit (or to flip `paused`) never resets fields you
 * didn't pass. Does NOT touch `paused` unless explicitly included in the
 * override JSON — the kill switch is a separate, deliberate action.
 */

import * as admin from "firebase-admin";
import { DEFAULT_CEILINGS } from "../src/middleware/circuitBreaker.js";

function parseArgs(): { org: string; overrides: Record<string, unknown> } {
  const org = process.argv[2];
  if (!org || !/^[a-z0-9_-]{1,64}$/.test(org)) {
    console.error('ERROR: pass a tenant/org id as argv[1], e.g. "lore". Must match ^[a-z0-9_-]{1,64}$');
    process.exit(1);
  }
  const raw = process.argv[3];
  let overrides: Record<string, unknown> = {};
  if (raw) {
    try {
      overrides = JSON.parse(raw);
    } catch (err) {
      console.error(`ERROR: argv[2] is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  return { org, overrides };
}

async function main() {
  const { org, overrides } = parseArgs();

  admin.initializeApp();
  const db = admin.firestore();

  const ref = db.doc(`tenants/${org}/_meta/ceilings`);
  const existing = await ref.get();

  const doc = {
    ...(existing.exists ? {} : DEFAULT_CEILINGS),
    ...overrides,
  };

  await ref.set(doc, { merge: true });

  console.log(
    `${existing.exists ? "Updated" : "Seeded"} tenants/${org}/_meta/ceilings:`,
    JSON.stringify((await ref.get()).data()),
  );
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
