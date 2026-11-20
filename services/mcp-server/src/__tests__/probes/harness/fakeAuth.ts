import * as http from "http";
import * as net from "net";

/**
 * Stand-in for the Firebase Auth emulator: firebase-admin's verifyIdToken (emulator mode) accepts an unsigned token, then
 * asks the emulator `accounts:lookup` whether the user exists. This answers that one call with an enabled user, so a probe
 * can present a Firebase-minted credential (harness/firebase.ts) without starting the Auth emulator (CI runs firestore only).
 * It lives in the globalSetup process and is unref'd, so it never holds the run open.
 */
export async function startFakeAuth(): Promise<{ host: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let ids: string[] = [];
      try { ids = JSON.parse(body).localId ?? []; } catch { /* none */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false, validSince: "0", lastLoginAt: "0" })) }));
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
  server.unref();
  return { host: `127.0.0.1:${port}`, close: () => server.close() };
}
