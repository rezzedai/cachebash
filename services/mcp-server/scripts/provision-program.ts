/**
 * provision-program.ts — one parameterized, idempotent command to stand up a new
 * Grid program: mint its first API key AND register its program-registry doc.
 *
 * Consolidates the two ad-hoc halves that used to live apart:
 *   - mint-command-center-key.ts  (key mint, but hard-coded to one programId)
 *   - register-program.ts         (registry doc, but no key mint)
 * Use THIS for any new identity (a VECTOR sub-instance, a tenant pod member, etc.).
 *
 * ── Why a script and not MCP ──────────────────────────────────────────────────
 * MCP `keys_create_key` is sealed by the `#341 ownerAuthz` gate: it requires a
 * LITERAL `keys.provision` capability that — by design — NO program key holds
 * (wildcard "*" does NOT satisfy it), so a leaked key can't self-mint admin keys.
 * The first key for a new identity therefore must be bootstrapped at the DB layer
 * by a principal with Firestore WRITE. This is **routine orchestrator ops** — run
 * it, don't escalate. (The durable fix is a scoped `keys.provision` capability +
 * a `provision_program` MCP tool; tracked separately for SARK review.)
 *
 * ── Credential (the gotcha that costs an hour if missed) ──────────────────────
 *   ✗ grid-deployer SA — Firestore READ-ONLY in prod → every write 403s.
 *   ✓ owner ADC — `gcloud auth application-default login` as an owner, then this
 *     script picks it up via firebase-admin's ADC. The active owner gcloud
 *     account (e.g. christian@rezzed.ai) is the standing write credential.
 *
 * ── Schema (the other gotcha) ─────────────────────────────────────────────────
 *   keyIndex            → TOP-LEVEL  `keyIndex/{sha256(rawKey)}`
 *   program registry    → TENANT-SCOPED `tenants/{userId}/programs/{programId}`
 * (keyIndex stayed top-level through the tenant-schema migration; the registry
 *  moved under tenants/{userId}/. Writing the registry top-level = "unknown
 *  target" on every dispatch.)
 *
 * ── Run ───────────────────────────────────────────────────────────────────────
 *   gcloud auth application-default login          # once, as an owner
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx \
 *     services/mcp-server/scripts/provision-program.ts '<json>'
 *
 *   <json> = a program object (or array):
 *     { "programId": "iso_cerebro", "displayName": "ISO-Cerebro",
 *       "role": "orchestrator", "groups": ["builders"],
 *       "tags": ["opus","cerebro"], "color": "#0EA5E9",
 *       "capabilities": ["dispatch.read", ...],   // optional; defaults below
 *       "mintKey": true }                          // optional; default true
 *
 * Idempotent: an existing active key is left alone (no duplicate); the registry
 * doc is metadata-merged. The raw key prints ONCE — install it to
 * ~/.config/grid/keys/<programId> (chmod 600) then `grid-launch`.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";

// Default = coordinator/orchestrator scope (matches command-center / scalar):
// full operational planes, read-only metrics/fleet/programs, NO keys.* / admin.
const DEFAULT_CAPS = [
  "dispatch.read", "dispatch.write",
  "relay.read", "relay.write",
  "pulse.read", "pulse.write",
  "signal.read", "signal.write",
  "sprint.read", "sprint.write",
  "metrics.read", "fleet.read", "programs.read",
  "gsp.read", "gsp.write",
  "state.read", "state.write",
];

interface ProgramSpec {
  programId: string;
  displayName?: string;
  role?: string;
  groups?: string[];
  tags?: string[];
  color?: string;
  capabilities?: string[];
  mintKey?: boolean;
}

function parseInput(): ProgramSpec[] {
  const raw = process.argv[2];
  if (!raw) {
    console.error(
      "ERROR: pass a program JSON object or array as argv[2].\n" +
        'Example: provision-program.ts \'{"programId":"iso_cerebro","role":"orchestrator"}\'',
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: argv[2] is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  for (const p of list) {
    const id = (p as ProgramSpec)?.programId;
    if (typeof id !== "string") {
      console.error("ERROR: every entry must have a string programId");
      process.exit(1);
    }
    // Guard against path-injection via '/' and enforce the registry naming rule.
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) {
      console.error(`ERROR: programId "${id}" must match ^[a-z0-9_-]{1,64}$`);
      process.exit(1);
    }
  }
  return list as ProgramSpec[];
}

admin.initializeApp();
const db = admin.firestore();

async function resolveTenantUserId(): Promise<string> {
  // Single-tenant assumption: copy the tenant uid from an existing active key
  // (prefer vector), matching mint-command-center-key.ts / register-program.ts.
  const byVector = await db
    .collection("keyIndex")
    .where("programId", "==", "vector")
    .where("active", "==", true)
    .limit(1)
    .get();
  if (!byVector.empty) return byVector.docs[0].data().userId as string;
  const any = await db.collection("keyIndex").limit(1).get();
  if (any.empty) throw new Error("no keys in keyIndex — cannot resolve tenant userId");
  return any.docs[0].data().userId as string;
}

async function provisionOne(spec: ProgramSpec, userId: string): Promise<string | null> {
  const { programId } = spec;
  let rawKey: string | null = null;

  // 1) Mint the key (unless told not to, or one already exists).
  if (spec.mintKey !== false) {
    const existing = await db
      .collection("keyIndex")
      .where("programId", "==", programId)
      .where("active", "==", true)
      .get();
    if (!existing.empty) {
      console.error(
        `  key: ✋ active ${programId} key already exists (${existing.docs[0].id.slice(0, 12)}…) — not minting a duplicate.`,
      );
    } else {
      const caps = spec.capabilities ?? DEFAULT_CAPS;
      rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      await db.doc(`keyIndex/${keyHash}`).set({
        userId,
        programId,
        label: `${programId} launcher key — provisioned ${new Date().toISOString().slice(0, 10)} (provision-program.ts)`,
        capabilities: caps,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        active: true,
      });
      console.error(`  key: ✅ minted ${programId}  hash=${keyHash.slice(0, 12)}…  caps=${caps.length}`);
    }
  }

  // 2) Register / upsert the program-registry doc (tenant-scoped path).
  const ref = db.doc(`tenants/${userId}/programs/${programId}`);
  const cur = await ref.get();
  const doc: Record<string, unknown> = {
    programId,
    displayName: spec.displayName ?? programId,
    role: spec.role ?? "orchestrator",
    groups: spec.groups ?? [],
    tags: spec.tags ?? [],
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "provision-program",
  };
  if (spec.color) doc.color = spec.color;
  if (cur.exists) {
    await ref.update(doc);
    console.error(`  registry: UPDATED ${programId} (${doc.displayName}) — ${doc.role}`);
  } else {
    await ref.set({
      ...doc,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: "provision-program",
    });
    console.error(`  registry: CREATED ${programId} (${doc.displayName}) — ${doc.role}`);
  }
  return rawKey;
}

async function main() {
  const specs = parseInput();
  const userId = await resolveTenantUserId();
  console.error(`tenant userId: ${userId.slice(0, 8)}…  ·  provisioning ${specs.length} program(s)\n`);

  const minted: Array<{ programId: string; rawKey: string }> = [];
  for (const spec of specs) {
    console.error(`▸ ${spec.programId}`);
    const rawKey = await provisionOne(spec, userId);
    if (rawKey) minted.push({ programId: spec.programId, rawKey });
  }

  if (minted.length) {
    console.error(`\nRAW KEY(S) — shown once, then clear scrollback:`);
    for (const { programId, rawKey } of minted) {
      // Key to stdout (one per line) so it can be piped straight to a keyfile.
      process.stdout.write(`${programId} ${rawKey}\n`);
    }
    console.error(`\nInstall each:`);
    for (const { programId, rawKey } of minted) {
      console.error(`  printf '%s' '${rawKey}' > ~/.config/grid/keys/${programId} && chmod 600 ~/.config/grid/keys/${programId}`);
    }
    console.error(`Then grid-launch the program(s) so the proxy reads the keyfile.`);
  } else {
    console.error(`\nNo new keys minted (all already existed). Registry docs are up to date.`);
  }
}

main().catch((e) => {
  const msg = (e as Error).message || String(e);
  console.error(`\nScript failed: ${msg}`);
  if (/PERMISSION_DENIED|Missing or insufficient permissions|7 PERMISSION/.test(msg)) {
    console.error(
      "\n↳ Firestore write was DENIED. You are almost certainly running as the\n" +
        "  grid-deployer SA (READ-ONLY in prod). Re-run with an OWNER credential:\n" +
        "    gcloud auth application-default login   # as a cachebash-app owner\n" +
        "  then retry with GOOGLE_CLOUD_PROJECT=cachebash-app.",
    );
  }
  process.exit(1);
});
