/**
 * Build identity for /v1/health (RD-5 PR-A).
 *
 * Every field is always a non-empty string; a missing, empty or unreadable
 * value is the string "unknown". Nothing here throws.
 *
 * Precedence for gitSha and buildTime (per field):
 *   1. build-info.json (written by scripts/deploy-mcp.sh, copied into the image)
 *   2. GIT_SHA / BUILD_TIME env (set from the Dockerfile ARGs, for local docker build)
 *   3. "unknown"
 * revision and service come only from K_REVISION / K_SERVICE (Cloud Run).
 *
 * File location: <package root>/build-info.json. From dist/utils (built) and
 * src/utils (ts-jest) alike, that is two directories up: /app/build-info.json
 * in the image, services/mcp-server/build-info.json in the repo.
 */

import { readFileSync } from "fs";
import path from "path";

export const UNKNOWN = "unknown";

export interface BuildIdentity {
  revision: string;
  service: string;
  gitSha: string;
  buildTime: string;
}

export const DEFAULT_BUILD_INFO_PATH = path.resolve(__dirname, "..", "..", "build-info.json");

function clean(value: unknown): string {
  if (typeof value !== "string") return UNKNOWN;
  const trimmed = value.trim();
  return trimmed === "" ? UNKNOWN : trimmed;
}

function readFileFields(filePath: string): { gitSha: string; buildTime: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { gitSha: UNKNOWN, buildTime: UNKNOWN };
    }
    const obj = parsed as Record<string, unknown>;
    return { gitSha: clean(obj.gitSha), buildTime: clean(obj.buildTime) };
  } catch {
    return { gitSha: UNKNOWN, buildTime: UNKNOWN };
  }
}

export function resolveBuildIdentity(
  env: NodeJS.ProcessEnv = process.env,
  filePath: string = DEFAULT_BUILD_INFO_PATH
): BuildIdentity {
  const file = readFileFields(filePath);
  const pick = (fromFile: string, fromEnv: unknown): string =>
    fromFile !== UNKNOWN ? fromFile : clean(fromEnv);
  return {
    revision: clean(env.K_REVISION),
    service: clean(env.K_SERVICE),
    gitSha: pick(file.gitSha, env.GIT_SHA),
    buildTime: pick(file.buildTime, env.BUILD_TIME),
  };
}

let cached: BuildIdentity | undefined;

/** Resolved once per process: the file and env cannot change under a running revision. */
export function getBuildIdentity(): BuildIdentity {
  if (!cached) cached = resolveBuildIdentity();
  return cached;
}
