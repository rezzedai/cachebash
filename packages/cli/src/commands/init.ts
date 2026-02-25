import { browserAuth } from "../auth/browser-auth.js";
import { writeConfig, verifyConnection } from "../config/writer.js";
import { Spinner, printSuccess, printError, printStep, green, bold } from "../ui/output.js";

export async function runInit(providedKey?: string): Promise<void> {
  let apiKey: string;

  if (providedKey) {
    printStep("Using provided API key");
    apiKey = providedKey;
  } else {
    const result = await browserAuth();
    apiKey = result.apiKey;
    printSuccess(`Authenticated as ${result.userId}`);
  }

  // Write config
  const configPath = await writeConfig(apiKey);

  // Verify connectivity
  const spinner = new Spinner();
  spinner.start("Verifying connection...");

  const ok = await verifyConnection(apiKey);
  if (ok) {
    spinner.stop();
    console.log("");
    printSuccess(bold("Done! CacheBash is connected."));
    printStep(`Config: ${configPath}`);
    printStep(`Try: ${green("cachebash ping")}`);
    printStep("Or send your first task from the mobile app.");
    console.log("");
  } else {
    spinner.stop();
    printError("Connection verification failed.");
    printStep("Your config was written, but the MCP endpoint didn't respond.");
    printStep("Check your network connection and try: cachebash ping");
  }
}
