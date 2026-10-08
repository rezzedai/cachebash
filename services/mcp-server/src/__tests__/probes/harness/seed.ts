import { Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { emulatorDb, newKey, sha256 } from "./emulator";
import * as path from "path";
import { MCP_SERVER_DIR } from "./server";
import type { CredentialName, WorldCredential } from "./world";

// globalSetup is not subject to jest's moduleNameMapper, so read the capability tables from the BUILT code
// (the same dist/ the server under test runs from).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const caps = require(path.join(process.env.PROBE_SERVER_DIR || MCP_SERVER_DIR, "dist/middleware/capabilities.js")) as {
  WINGMAN_TIER_CAPABILITIES: string[];
  TOOL_CAPABILITIES: Record<string, string>;
};
const WINGMAN_TIER_CAPABILITIES = caps.WINGMAN_TIER_CAPABILITIES;
const TOOL_CAPABILITIES = caps.TOOL_CAPABILITIES;

const rid = () => crypto.randomBytes(4).toString("hex");

/** Capabilities that must be granted by name; never part of `scoped`. */
const NEVER_IN_SCOPED = new Set(["*", "fleet.observe", "fleet.admin", "keys.provision", "keys.admin"]);

/** Every capability a tool needs, literally, except the wildcard / fleet / provisioning ones. */
export function scopedCapabilities(): string[] {
  const caps = new Set<string>(WINGMAN_TIER_CAPABILITIES);
  for (const c of Object.values(TOOL_CAPABILITIES)) caps.add(c);
  return [...caps].filter((c) => !NEVER_IN_SCOPED.has(c)).sort();
}

interface Spec {
  name: CredentialName;
  tenant: "A" | "B";
  programId: string;
  capabilities: string[];
}

/** The six credentials of the plan (section 5) plus `scoped` (see PR description: why). */
export function credentialSpecs(): Spec[] {
  const preset = [...WINGMAN_TIER_CAPABILITIES] as string[];
  return [
    { name: "restricted", tenant: "A", programId: "alpha", capabilities: preset },
    { name: "scoped", tenant: "A", programId: "alpha", capabilities: scopedCapabilities() },
    { name: "wildcard", tenant: "A", programId: "alpha", capabilities: ["*"] },
    { name: "observer", tenant: "A", programId: "beta", capabilities: [...preset, "fleet.observe"] },
    { name: "admin", tenant: "A", programId: "beta", capabilities: [...preset, "fleet.admin"] },
    { name: "tenantB", tenant: "B", programId: "alpha", capabilities: ["*"] },
    { name: "disposable", tenant: "A", programId: "alpha", capabilities: preset },
  ];
}

export async function writeKey(
  tenantUid: string, programId: string, label: string, capabilities: string[]
): Promise<{ key: string; keyHash: string }> {
  const db = emulatorDb();
  const key = newKey();
  const keyHash = sha256(key);
  await db.doc(`keyIndex/${keyHash}`).set({
    userId: tenantUid,
    programId,
    label,
    capabilities,
    active: true,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000),
  });
  return { key, keyHash };
}

export async function seedTenant(tenantUid: string): Promise<void> {
  const db = emulatorDb();
  await db.doc(`tenants/${tenantUid}/_meta/ceilings`).set({ perKeyLimit: 100000, orgLimit: 500000, windowMs: 60000, paused: false });
  for (const programId of ["alpha", "beta"]) {
    await db.doc(`tenants/${tenantUid}/programs/${programId}`).set({
      programId, displayName: programId, role: "custom", color: "#808080", groups: [], tags: [],
      createdAt: Timestamp.now(), createdBy: "probe-setup", active: true,
    });
  }
}

export async function seedAll(): Promise<{
  tenants: { A: string; B: string };
  creds: Record<CredentialName, WorldCredential>;
  seeders: { A: WorldCredential; B: WorldCredential };
}> {
  const tenants = { A: `probe-a-${rid()}`, B: `probe-b-${rid()}` };
  await seedTenant(tenants.A);
  await seedTenant(tenants.B);
  const creds = {} as Record<CredentialName, WorldCredential>;
  for (const spec of credentialSpecs()) {
    const tenantUid = tenants[spec.tenant];
    const { key, keyHash } = await writeKey(tenantUid, spec.programId, `probe-${spec.name}`, spec.capabilities);
    creds[spec.name] = { ...spec, tenantUid, key, keyHash };
  }
  const seeders = {} as { A: WorldCredential; B: WorldCredential };
  for (const t of ["A", "B"] as const) {
    const tenantUid = tenants[t];
    const { key, keyHash } = await writeKey(tenantUid, "legacy", `probe-seeder-${t}`, ["*"]);
    seeders[t] = { name: "wildcard", tenant: t, tenantUid, programId: "legacy", capabilities: ["*"], key, keyHash };
  }
  return { tenants, creds, seeders };
}
