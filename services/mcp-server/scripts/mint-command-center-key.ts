/**
 * Mint command-center's API key — closes the identity gap where the
 * command-center CLI session had no keyfile and fell back (pre-#775) to a
 * leaked shared key, running as scalar. (2026-06-11, Flynn-authorized.)
 *
 * Why a script and not keys_create_key via MCP: the #341 ownerAuthz gate
 * requires a LITERAL `keys.provision` capability to mint, and — by design — NO
 * program key holds it (wildcard "*" deliberately does not satisfy it). So the
 * very first key for a new identity must be bootstrapped at the DB layer by a
 * principal with Firestore write (Flynn / datastore.owner). This script does
 * EXACTLY what modules/keys.ts createKey does: generate cb_<hex>, sha256 the
 * doc id, write keyIndex/<hash> with bounded caps + active:true. It grants NO
 * `keys.provision` to anyone — it only creates one coordinator key.
 *
 * Run with write-capable creds (NOT grid-deployer — that SA is Firestore
 * read-only in prod):
 *   gcloud auth application-default login   # as an owner, OR a key with datastore write
 *   GOOGLE_CLOUD_PROJECT=cachebash-app npx tsx services/mcp-server/scripts/mint-command-center-key.ts
 *
 * Idempotent: refuses if an active command-center key already exists.
 * The raw key prints ONCE — save it to ~/.config/grid/keys/command-center
 * (chmod 600) on the machine running the command-center session.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";

const PROGRAM = "command-center";
// Coordinator scope: full dispatch/relay/pulse/signal/sprint/gsp/state +
// read-only metrics/fleet/programs. NO keys.* / admin (least privilege; a
// coordinator never mints).
const CAPS = [
  "dispatch.read", "dispatch.write",
  "relay.read", "relay.write",
  "pulse.read", "pulse.write",
  "signal.read", "signal.write",
  "sprint.read", "sprint.write",
  "metrics.read", "fleet.read", "programs.read",
  "gsp.read", "gsp.write",
  "state.read", "state.write",
];

admin.initializeApp();
const db = admin.firestore();

async function main() {
  // Tenant uid is shared across the fleet; copy it from an existing key so the
  // new doc lands in the same tenant (createKey copies auth.userId likewise).
  const ref = await db.collection("keyIndex")
    .where("programId", "==", "vector").where("active", "==", true).limit(1).get();
  if (ref.empty) throw new Error("no active vector key to read tenant uid from");
  const userId = ref.docs[0].data().userId as string;

  const existing = await db.collection("keyIndex")
    .where("programId", "==", PROGRAM).where("active", "==", true).get();
  if (!existing.empty) {
    console.log(`✋ active ${PROGRAM} key already exists (${existing.docs[0].id.slice(0, 12)}…) — not minting a duplicate.`);
    return;
  }

  const rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  await db.doc(`keyIndex/${keyHash}`).set({
    userId,
    programId: PROGRAM,
    label: `COMMAND-CENTER CLI keyfile — minted ${new Date().toISOString().slice(0, 10)} (identity-incident remediation; coordinator scope, no keys/admin)`,
    capabilities: CAPS,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    active: true,
  });

  console.log(`✅ minted ${PROGRAM} key  hash=${keyHash.slice(0, 12)}…`);
  console.log(`\nRAW KEY (shown once — save then clear scrollback):\n${rawKey}\n`);
  console.log(`Install:\n  printf '%s' '${rawKey}' > ~/.config/grid/keys/${PROGRAM} && chmod 600 ~/.config/grid/keys/${PROGRAM}`);
  console.log(`Then recycle/restart the command-center session so the proxy reads the keyfile.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
