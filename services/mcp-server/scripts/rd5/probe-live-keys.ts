/**
 * RD-5 R11 probe. For each key file in --keys-dir: initialize a session and call
 * tools/list. Prints hash prefix, HTTP status and tool count. Never prints a key.
 * Calls no tool: relay_get_messages drains and is never an auth probe.
 * Usage: npx tsx services/mcp-server/scripts/rd5/probe-live-keys.ts --keys-dir <dir> --base-url <url>
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { formatProbeRow, keyFromFileContent, probeKey } from "../../src/auth/rd5/probeLiveKeys.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dir = arg("--keys-dir");
  const baseUrl = arg("--base-url") ?? process.env.CACHEBASH_URL;
  if (!dir || !baseUrl) {
    console.error("usage: probe-live-keys.ts --keys-dir <dir> --base-url <url> (or CACHEBASH_URL)");
    process.exit(2);
  }
  const files = readdirSync(dir).sort().filter((f) => statSync(join(dir, f)).isFile());
  let n = 0;
  for (const f of files) {
    const key = keyFromFileContent(readFileSync(join(dir, f), "utf8"));
    if (!key) continue;
    console.log(formatProbeRow(await probeKey(fetch as never, baseUrl, key)));
    n++;
  }
  console.log(`\n${n} keys probed against ${baseUrl}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "probe failed");
  process.exit(1);
});
