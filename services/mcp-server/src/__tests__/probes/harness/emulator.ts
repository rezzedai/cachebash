import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { assertEmulatorOnly } from "./guard";

let app: admin.app.App | null = null;

/** Firestore pointed at the emulator. assertEmulatorOnly runs first, every time. */
export function emulatorDb(): admin.firestore.Firestore {
  const target = assertEmulatorOnly();
  if (!app) {
    app = admin.initializeApp({ projectId: target.projectId }, `probes-${process.pid}`);
  }
  return app.firestore();
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
