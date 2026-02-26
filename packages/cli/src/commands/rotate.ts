import { readFile } from "node:fs/promises";
import { detectConfigs, writeConfig } from "../config/writer.js";
import { Spinner, printSuccess, printError, printStep } from "../ui/output.js";

const MCP_URL = process.env.CACHEBASH_MCP_URL || "https://api.cachebash.dev/v1/mcp";

export async function runRotate(): Promise<void> {
  // 1. Read current API key from config
  const configs = await detectConfigs();
  if (configs.length === 0) {
    printError("No API key found. Run `cachebash init` first.");
    process.exit(1);
  }

  const target = configs[0];
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

  // 2. Call rotate_key via MCP
  const spinner = new Spinner();
  spinner.start("Rotating API key...");

  try {
    // Initialize MCP session
    const initRes = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "cachebash-cli", version: "0.1.1" },
        },
        id: 1,
      }),
    });

    if (!initRes.ok) {
      spinner.stop();
      if (initRes.status === 401) {
        printError("Key is already revoked. Run `cachebash init` to set up a new key.");
      } else {
        printError(`Server returned ${initRes.status}`);
      }
      process.exit(1);
    }

    // Call rotate_key tool
    const toolRes = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rotate_key",
          arguments: {},
        },
        id: 2,
      }),
    });

    if (!toolRes.ok) {
      spinner.stop();
      printError(`Failed to rotate key (${toolRes.status})`);
      process.exit(1);
    }

    const toolData = await toolRes.json() as any;
    const resultText = toolData?.result?.content?.[0]?.text;
    if (!resultText) {
      spinner.stop();
      printError("Unexpected response from server");
      process.exit(1);
    }

    const result = JSON.parse(resultText);

    if (!result.success) {
      spinner.stop();
      printError(result.error || result.message || "Rotation failed");
      process.exit(1);
    }

    spinner.stop();
    printSuccess("Current key verified");

    // 3. Write new key to config
    await writeConfig(result.key);

    printSuccess(`Key rotated. Old key expires in ${result.graceWindowSeconds || 30} seconds.`);
  } catch (err) {
    spinner.stop();
    printError(`Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`);
    printStep("Check your network connection and try again.");
    process.exit(1);
  }
}
