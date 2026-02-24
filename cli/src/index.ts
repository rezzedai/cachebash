#!/usr/bin/env node

import { runInit } from "./commands/init.js";
import { runPing } from "./commands/ping.js";
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
