import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import * as readline from "node:readline/promises";
import { printStep, printSuccess, printWarning, green, bold } from "../ui/output.js";

const MCP_URL = process.env.CACHEBASH_MCP_URL || "https://api.cachebash.dev/v1/mcp";

interface ConfigTarget {
  name: string;
  path: string;
  key: string; // JSON path for the MCP server entry
}

function getConfigTargets(): ConfigTarget[] {
  const home = homedir();
  return [
    { name: "Claude Code", path: join(home, ".claude.json"), key: "mcpServers" },
    { name: "Claude Desktop", path: join(home, ".claude", "claude_desktop_config.json"), key: "mcpServers" },
    { name: "Cursor", path: join(home, ".cursor", "mcp.json"), key: "mcpServers" },
    { name: "VS Code", path: join(home, ".vscode", "settings.json"), key: "mcp.servers" },
  ];
}

function buildServerEntry(apiKey: string): Record<string, unknown> {
  return {
    type: "http",
    url: MCP_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

export async function detectConfigs(): Promise<ConfigTarget[]> {
  return getConfigTargets().filter((t) => existsSync(t.path));
}

export async function writeConfig(apiKey: string): Promise<string> {
  const found = await detectConfigs();
  let target: ConfigTarget;

  if (found.length === 0) {
    // Default to Claude Code
    target = getConfigTargets()[0];
    printStep(`No MCP config found. Creating ${target.path}`);
  } else if (found.length === 1) {
    target = found[0];
    printStep(`Found ${target.name} config at ${target.path}`);
  } else {
    // Multiple found — prompt user
    console.log("\n  Multiple MCP configs found:");
    found.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.path})`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n  Which config should I update? [1-${found.length}]: `);
    rl.close();

    const idx = parseInt(answer, 10) - 1;
    if (idx < 0 || idx >= found.length) {
      target = found[0];
      printWarning(`Invalid choice, using ${target.name}`);
    } else {
      target = found[idx];
    }
  }

  // Read existing config or create new
  let config: Record<string, any> = {};
  try {
    const content = await readFile(target.path, "utf-8");
    config = JSON.parse(content);
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  // Merge server entry
  const entry = buildServerEntry(apiKey);

  if (target.key === "mcp.servers") {
    // VS Code nested path
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.servers) config.mcp.servers = {};
    config.mcp.servers.cachebash = entry;
  } else {
    if (!config[target.key]) config[target.key] = {};
    config[target.key].cachebash = entry;
  }

  // Ensure directory exists
  const dir = dirname(target.path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(target.path, JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  // Ensure permissions on pre-existing files too (writeFile mode only applies to new files)
  await chmod(target.path, 0o600);
  printSuccess(`Config written to ${target.path}`);

  return target.path;
}

export async function verifyConnection(apiKey: string): Promise<boolean> {
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
    return res.ok;
  } catch {
    return false;
  }
}
