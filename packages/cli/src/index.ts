#!/usr/bin/env node

import { runInit } from "./commands/init.js";
import { runPing } from "./commands/ping.js";
import { runFeedback } from "./commands/feedback.js";
import { printBanner, printHelp, printError } from "./ui/output.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  printBanner();

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "init": {
      const keyIndex = args.indexOf("--key");
      const key = keyIndex !== -1 ? args[keyIndex + 1] : undefined;
      await runInit(key);
      break;
    }
    case "ping":
      await runPing();
      break;
    case "feedback": {
      // Parse --type/-t flag, default to "general"
      const typeIndex = args.indexOf("--type") !== -1 ? args.indexOf("--type") : args.indexOf("-t");
      let type = "general";
      if (typeIndex !== -1 && args[typeIndex + 1]) {
        const t = args[typeIndex + 1];
        if (["bug", "feature", "general"].includes(t)) {
          type = t === "feature" ? "feature_request" : t;
        } else {
          printError(`Invalid type: ${t}. Use: bug, feature, or general`);
          process.exit(1);
        }
      }

      // Collect message: everything that's not a flag
      const messageArgs = args.slice(1).filter((a, i) => {
        // Skip --type/-t and its value
        if (a === "--type" || a === "-t") return false;
        const prevArg = args.slice(1)[i - 1];
        if (prevArg === "--type" || prevArg === "-t") return false;
        return true;
      });
      const message = messageArgs.join(" ");

      if (!message) {
        printError("Message required. Usage: cachebash feedback \"your message\"");
        printError("  cachebash feedback --type bug \"description of the issue\"");
        process.exit(1);
      }

      await runFeedback(type, message);
      break;
    }
    default:
      printError(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  printError(err.message || "Unexpected error");
  process.exit(1);
});
