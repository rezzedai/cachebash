import { readFile } from "node:fs/promises";
import os from "node:os";
import { detectConfigs } from "../config/writer.js";
import { Spinner, printSuccess, printError, printStep } from "../ui/output.js";

const MCP_URL = "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp";

export async function runFeedback(type: string, message: string): Promise<void> {
  // 1. Validate message
  if (!message || message.trim().length === 0) {
    printError("Message is required. Usage: cachebash feedback \"your message here\"");
    process.exit(1);
  }
  if (message.length > 2000) {
    printError("Message must be 2000 characters or less.");
    process.exit(1);
  }

  // 2. Read API key from config (same pattern as ping.ts)
  const configs = await detectConfigs();
  if (configs.length === 0) {
    printError("No MCP config found. Run `cachebash init` first.");
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

  // 3. Submit feedback via MCP server
  const spinner = new Spinner();
  const typeLabel = type === 'bug' ? 'bug report' : type === 'feature_request' ? 'feature request' : 'feedback';
  spinner.start(`Submitting ${typeLabel}...`);

  try {
    // Step 1: Initialize MCP session
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
          clientInfo: { name: "cachebash-cli", version: "0.1.0" },
        },
        id: 1,
      }),
    });

    if (!initRes.ok) {
      spinner.stop();
      if (initRes.status === 401) {
        printError("Authentication failed — API key may be invalid or revoked.");
      } else {
        printError(`Server returned ${initRes.status}`);
      }
      process.exit(1);
    }

    // Step 2: Call submit_feedback tool
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
          name: "submit_feedback",
          arguments: {
            type,
            message: message.trim(),
            platform: "cli",
            appVersion: "cli-0.1.0",
            osVersion: `${process.platform} ${os.release()}`,
            deviceModel: os.hostname(),
          },
        },
        id: 2,
      }),
    });

    if (!toolRes.ok) {
      spinner.stop();
      printError(`Failed to submit feedback (${toolRes.status})`);
      process.exit(1);
    }

    const toolData = await toolRes.json() as any;

    // Parse the MCP tool response
    // MCP tools return { result: { content: [{ type: "text", text: "..." }] } }
    const resultText = toolData?.result?.content?.[0]?.text;
    if (!resultText) {
      spinner.stop();
      printError("Unexpected response from server");
      process.exit(1);
    }

    const result = JSON.parse(resultText);

    spinner.stop();

    if (result.success) {
      printSuccess("Feedback submitted");
      if (result.issueUrl) {
        printStep(`Track it: ${result.issueUrl}`);
      }
    } else {
      printError(result.message || "Failed to submit feedback");
      process.exit(1);
    }
  } catch (err) {
    spinner.stop();
    printError(`Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    printStep("Check your network connection and try again.");
    process.exit(1);
  }
}
