import { initializeApp, type App } from "firebase-admin/app";
import * as crypto from "crypto";
import { assertEmulatorOnly } from "./guard";
import { Firestore, getFirestore } from "firebase-admin/firestore";

let app: App | null = null;

/** Firestore pointed at the emulator. assertEmulatorOnly runs first, every time. */
export function emulatorDb(): Firestore {
  const target = assertEmulatorOnly();
  if (!app) {
    app = initializeApp({ projectId: target.projectId }, `probes-${process.pid}`);
  }
  return getFirestore(app);
}

export const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** Fresh random key per run. Never written to the repo. */
export const newKey = (): string => `cb_${crypto.randomBytes(32).toString("hex")}`;

export async function clearEmulator(): Promise<void> {
  const target = assertEmulatorOnly();
  const res = await fetch(
    `http://${target.emulatorHost}/emulator/v1/projects/${target.projectId}/databases/(default)/documents`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`clearEmulator failed: ${res.status} ${res.statusText}`);
}
