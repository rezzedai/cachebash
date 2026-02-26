import { randomBytes } from "node:crypto";
import { Spinner, printStep, printWarning, printError } from "../ui/output.js";

const CLI_AUTH_BASE =
  process.env.CACHEBASH_AUTH_URL ?? "https://cachebash-app.web.app/cli-auth";
const POLL_URL =
  process.env.CACHEBASH_POLL_URL ??
  "https://us-central1-cachebash-app.cloudfunctions.net/cliAuthStatus";
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface AuthResult {
  apiKey: string;
  userId: string;
}

export async function browserAuth(): Promise<AuthResult> {
  const sessionToken = randomBytes(32).toString("hex");
  const authUrl = `${CLI_AUTH_BASE}?session=${sessionToken}`;

  printStep("Opening browser for authentication...");

  try {
    const open = (await import("open")).default;
    await open(authUrl);
  } catch {
    printWarning("Could not open browser automatically.");
    console.log(`\n  Open this URL to authenticate:\n  ${authUrl}\n`);
  }

  const spinner = new Spinner();
  spinner.start("Waiting for approval... (press Ctrl+C to cancel)");

  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const res = await fetch(`${POLL_URL}?session=${sessionToken}`);
      if (!res.ok) continue;

      const data = await res.json() as { status: string; apiKey?: string; userId?: string };

      if (data.status === "approved" && data.apiKey && data.userId) {
        spinner.stop();
        return { apiKey: data.apiKey, userId: data.userId };
      }

      if (data.status === "expired") {
        spinner.stop();
        throw new Error("Authentication session expired. Run `cachebash init` to try again.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("expired")) throw err;
      // Network errors — keep polling
    }
  }

  spinner.stop();
  throw new Error("Authentication timed out after 5 minutes. Run `cachebash init` to try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
