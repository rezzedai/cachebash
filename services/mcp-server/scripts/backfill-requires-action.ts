#!/usr/bin/env tsx
/**
 * WP-1 — one-time backfill of `requires_action` onto task documents that
 * predate this fix and have no `requires_action` field at all.
 *
 * WHY THIS EXISTS: WP-2 (a later, separate work package — NOT run by this
 * script) will add a server-side Firestore equality filter
 * `.where("requires_action", "==", true)` to get_tasks(). Firestore equality
 * filters EXCLUDE documents where the field is entirely missing. Every task
 * document written before WP-1 landed (by schedule-executor.ts, signal.ts,
 * wake-daemon.ts, sprint.ts, and the direct Firestore writers in
 * services/functions — see the WP-1 PR body for the full list) has no
 * requires_action field, and would silently vanish from get_tasks() once
 * WP-2 ships. This script finds and fixes exactly that population.
 *
 * SCOPE / CLASSIFICATION / IDEMPOTENCY: see
 * src/modules/dispatch/requiresActionBackfill.ts, the module this script
 * wraps — it holds all the scan/classify/write logic and lives under src/ so
 * it is covered by this package's own tsc build and directly testable from
 * jest against an injected fake Firestore. This file is CLI plumbing only
 * (arg parsing, real Firestore init, console reporting).
 *
 * SAFETY:
 *   - `--dry-run` is the DEFAULT. Running this script with NO flags is a dry
 *     run: it reports counts only and writes nothing.
 *   - `--apply` is REQUIRED to write. Omit it (or pass --dry-run explicitly)
 *     for a read-only report.
 *   - Idempotent: a doc is only ever a candidate while it is missing
 *     requires_action; once written, re-running finds it via a fresh scan and
 *     skips it (already has the field) — no double-apply, no cursor to persist.
 *   - Per-item error isolation: each batch is attempted atomically first (fast
 *     path); if the atomic commit itself fails, the wrapped module falls back
 *     to writing that batch's docs one at a time so a single bad/malformed
 *     document cannot abort its batch-mates. Every per-doc failure is caught,
 *     logged to `errors`, and the scan continues.
 *   - THIS SCRIPT MUST NEVER BE RUN WITH --apply AGAINST THE REAL/PRODUCTION
 *     FIRESTORE DATABASE. --dry-run is safe (read-only). Proving the write
 *     path works belongs in a test against a mocked/fake Firestore client or
 *     an emulator, never against prod. (Note also: per the PLAN-W1 ruling
 *     documented in expiresAtBackfillClassifier.ts / backfillExpiresAt.ts,
 *     grid-deployer's local developer credential has historically lacked
 *     Firestore write IAM on the prod project for exactly this class of ops
 *     script — the established convention for a real backfill EXECUTE path is
 *     inside the running service, under its own Cloud Run runtime service
 *     account, not a script run by hand. This script is built to the WP-1
 *     spec's literal --dry-run/--apply CLI shape; if/when a real production
 *     apply is ever authorized, confirm with ISO/Flynn which execution path
 *     and credential should be used before running it anywhere near prod.)
 *
 * Usage:
 *   npx tsx services/mcp-server/scripts/backfill-requires-action.ts            # dry-run (default)
 *   npx tsx services/mcp-server/scripts/backfill-requires-action.ts --dry-run  # same, explicit
 *   npx tsx services/mcp-server/scripts/backfill-requires-action.ts --apply    # writes — DO NOT run against prod
 *   npx tsx services/mcp-server/scripts/backfill-requires-action.ts --apply --limit 500
 *   npx tsx services/mcp-server/scripts/backfill-requires-action.ts --tenant <tenantId> --apply
 */

import * as admin from "firebase-admin";
import { runRequiresActionBackfill } from "../src/modules/dispatch/requiresActionBackfill.js";

function parseArgs(argv: string[]): { apply: boolean; limit?: number; tenant?: string } {
  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  if (apply && dryRunFlag) {
    console.error("ERROR: pass either --apply or --dry-run, not both.");
    process.exit(1);
  }
  let limit: number | undefined;
  const limitIdx = argv.indexOf("--limit");
  if (limitIdx !== -1) {
    const raw = argv[limitIdx + 1];
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(`ERROR: --limit requires a positive integer, got "${raw}"`);
      process.exit(1);
    }
    limit = parsed;
  }
  let tenant: string | undefined;
  const tenantIdx = argv.indexOf("--tenant");
  if (tenantIdx !== -1) tenant = argv[tenantIdx + 1];

  return { apply, limit, tenant };
}

async function resolveTenantId(db: admin.firestore.Firestore): Promise<string> {
  // Single-tenant Grid assumption, same resolution strategy as
  // scripts/register-program.ts: read any key's userId out of keyIndex.
  const keySnap = await db.collection("keyIndex").limit(1).get();
  if (keySnap.empty) {
    throw new Error("No keys in keyIndex — cannot resolve tenant userId. Pass --tenant <id> explicitly.");
  }
  return keySnap.docs[0].data().userId as string;
}

async function main(): Promise<void> {
  const { apply, limit, tenant } = parseArgs(process.argv.slice(2));

  if (apply) {
    console.warn(
      "[backfill-requires-action] --apply requested. This script has NO built-in " +
        "production guard beyond this warning and whatever Firestore write IAM the " +
        "current credential holds. NEVER run --apply against the real/production " +
        "Firestore database — see the file header. If you are seeing this warning " +
        "unexpectedly, stop and re-check the target project.",
    );
  }

  admin.initializeApp();
  const db = admin.firestore();
  const tenantId = tenant || (await resolveTenantId(db));

  console.log(`[backfill-requires-action] mode=${apply ? "APPLY" : "DRY-RUN"} tenant=${tenantId} limit=${limit ?? "none"}`);

  const result = await runRequiresActionBackfill(db, tenantId, { apply, limit });

  console.log(`\n[backfill-requires-action] scanned=${result.scanned} missingFieldFound=${result.missingFieldFound}`);
  console.log(`[backfill-requires-action] classified false (target=="user"): ${result.classifiedFalse}`);
  console.log(`[backfill-requires-action] classified true (all other targets): ${result.classifiedTrue}`);
  console.log(`[backfill-requires-action] breakdown by target value:`);
  for (const [target, count] of Object.entries(result.byTargetWouldUpdate).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${target}: ${count}`);
  }
  if (apply) {
    console.log(`[backfill-requires-action] updatedCount=${result.updatedCount}`);
    if (result.errors.length > 0) {
      console.warn(`[backfill-requires-action] ${result.errors.length} per-item errors (batch-mates were not aborted):`);
      for (const e of result.errors.slice(0, 20)) console.warn(`    ${e.id}: ${e.error}`);
    }
  } else {
    console.log(`[backfill-requires-action] DRY-RUN — no writes performed. Re-run with --apply to write.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill-requires-action] Script failed:", err);
    process.exit(1);
  });
}
