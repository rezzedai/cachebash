import { readFile } from "node:fs/promises";
import { detectConfigs, verifyConnection } from "../config/writer.js";
import { Spinner, printSuccess, printError, printStep, printWarning } from "../ui/output.js";

const MCP_URL = "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp";

export async function runPing(): Promise<void> {
  const configs = await detectConfigs();

  if (configs.length === 0) {
    printError("No MCP config found. Run `cachebash init` first.");
    process.exit(1);
  }

  // Try first found config
  const target = configs[0];
  printStep(`Reading config from ${target.path}`);

  let apiKey: string | undefined;
  try {
    const content = await readFile(target.path, "utf-8");
    const config = JSON.parse(content);
    const servers = target.key === "mcp.servers" ? config?.mcp?.servers : config?.[target.key];
    const auth = servers?.cachebash?.headers?.Authorization;
    if (auth && typeof auth === "string") {
      apiKey = auth.replace("Bearer ", "");
    }
  } catch {
    printError(`Failed to read config at ${target.path}`);
    process.exit(1);
  }

  if (!apiKey) {
    printError("No CacheBash API key found in config. Run `cachebash init` first.");
    process.exit(1);
  }

  const spinner = new Spinner();
  spinner.start("Pinging CacheBash MCP...");

  const start = Date.now();
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cachebash-cli", version: "0.1.0" } },
        id: 1,
      }),
    });

    const latency = Date.now() - start;

    if (res.ok) {
      const data = await res.json() as { result?: { serverInfo?: { name?: string } } };
      const serverName = data?.result?.serverInfo?.name || "CacheBash MCP";
      spinner.stop();
      printSuccess(`Connected to ${serverName} (${latency}ms)`);
    } else {
      spinner.stop();
      if (res.status === 401) {
        printError("Authentication failed — API key may be invalid or revoked.");
      } else {
        printError(`Server returned ${res.status} (${latency}ms)`);
      }
      process.exit(1);
    }
  } catch (err) {
    spinner.stop();
    printError(`Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    printStep("Check your network connection and try again.");
    process.exit(1);
  }
}
