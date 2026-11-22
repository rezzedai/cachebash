/** Shape of the JSON the globalSetup writes and every probe file reads. Contains per-run keys: never committed. */
export type CredentialName = "restricted" | "scoped" | "wildcard" | "bare" | "observer" | "admin" | "tenantB" | "disposable";

export interface WorldCredential {
  name: CredentialName;
  tenant: "A" | "B";
  tenantUid: string;
  programId: string;
  capabilities: string[];
  key: string;
  keyHash: string;
}

import type { SeedData } from "./data";

export interface World {
  baseUrl: string;
  serverPid: number;
  /** the server process log: stdout and stderr of dist/index.js, one JSON line per authz denial */
  serverLog: string;
  serverDir: string;
  projectId: string;
  emulatorHost: string;
  tenants: { A: string; B: string };
  creds: Record<CredentialName, WorldCredential>;
  /** setup-only credentials, one per tenant, program "legacy" with every mapped capability named (no wildcard) plus fleet.observe and fleet.admin; used to seed through the real handlers */
  seeders: { A: WorldCredential; B: WorldCredential };
  /** setup-only credentials, program "mobile" with every mapped capability named: the only seeders that may write program state (PR-J) */
  stateSeeders: { A: WorldCredential; B: WorldCredential };
  /** ids of the rows seeded through the real handlers, per tenant and program */
  seed: SeedData;
}

export const WORLD_FILE_ENV = "PROBE_WORLD_FILE";
