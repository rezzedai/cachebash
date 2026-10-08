/** Shape of the JSON the globalSetup writes and every probe file reads. Contains per-run keys: never committed. */
export type CredentialName = "restricted" | "scoped" | "wildcard" | "observer" | "admin" | "tenantB" | "disposable";

export interface WorldCredential {
  name: CredentialName;
  tenant: "A" | "B";
  tenantUid: string;
  programId: string;
  capabilities: string[];
  key: string;
  keyHash: string;
}

export interface World {
  baseUrl: string;
  serverPid: number;
  serverDir: string;
  authMode: string;
  projectId: string;
  emulatorHost: string;
  tenants: { A: string; B: string };
  creds: Record<CredentialName, WorldCredential>;
  /** setup-only credentials, one per tenant, program "legacy" with ["*"]; used to seed through the real handlers */
  seeders: { A: WorldCredential; B: WorldCredential };
}

export const WORLD_FILE_ENV = "PROBE_WORLD_FILE";
