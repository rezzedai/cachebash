/**
 * The probe harness refuses to run against anything but the local Firestore emulator.
 * Asserted before any seeding or server start (globalSetup), and tested in guard.probe.ts.
 *
 * Deliberately NOT copied from __tests__/integration/setup.ts, which defaults its project
 * id to the production project "cachebash-app".
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export class ProductionRefusal extends Error {
  constructor(reason: string) {
    super(`PROBE HARNESS REFUSES TO START: ${reason}`);
    this.name = "ProductionRefusal";
  }
}

export interface ProbeTarget {
  emulatorHost: string;
  projectId: string;
}

/** Throws ProductionRefusal unless env names a local emulator and a demo- project. */
export function assertEmulatorOnly(env: NodeJS.ProcessEnv = process.env): ProbeTarget {
  const raw = env.FIRESTORE_EMULATOR_HOST;
  if (!raw || !raw.trim()) {
    throw new ProductionRefusal("FIRESTORE_EMULATOR_HOST is not set (run via `firebase emulators:exec`).");
  }
  const m = /^([^:/\s]+):(\d{1,5})$/.exec(raw.trim());
  if (!m) {
    throw new ProductionRefusal(`FIRESTORE_EMULATOR_HOST must be host:port, got ${JSON.stringify(raw)}.`);
  }
  const host = m[1];
  if (!LOCAL_HOSTS.has(host)) {
    throw new ProductionRefusal(`FIRESTORE_EMULATOR_HOST host must be localhost or 127.0.0.1, got ${JSON.stringify(host)}.`);
  }
  // `firebase emulators:exec --project demo-rd5` exports GCLOUD_PROJECT; the server reads FIREBASE_PROJECT_ID.
  // Every project id that is set must be a demo- id, and at least one must be set.
  const ids = [env.FIREBASE_PROJECT_ID, env.GCLOUD_PROJECT].filter((v): v is string => typeof v === "string" && v !== "");
  if (ids.length === 0) {
    throw new ProductionRefusal("no project id: neither FIREBASE_PROJECT_ID nor GCLOUD_PROJECT is set.");
  }
  for (const id of ids) {
    if (!id.startsWith("demo-")) {
      throw new ProductionRefusal(`project id must start with "demo-", got ${JSON.stringify(id)}.`);
    }
  }
  return { emulatorHost: raw.trim(), projectId: ids[0] };
}
