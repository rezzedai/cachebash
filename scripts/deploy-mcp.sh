#!/usr/bin/env bash
# Deploy cachebash-mcp with build identity stamped (RD-5 PR-A).
#
# 1. Writes services/mcp-server/build-info.json (gitSha, buildTime). The file is
#    generated, gitignored, and copied into the image by the Dockerfile, which is
#    how /v1/health reports it. (.gcloudignore excludes .git/, so the build cannot
#    read the sha itself.)
# 2. Runs the documented deploy command UNCHANGED, from services/mcp-server.
#    Every real revision is a buildpack source deploy from that directory. From
#    the repo root the same command builds the root Dockerfile, and Cloud Run
#    refuses it: "Missing required argument [--clear-base-image]".
#
# A dirty working tree (tracked changes or untracked files, ignoring
# build-info.json itself) stamps "<sha>-dirty" and the deploy PROCEEDS.
#
# The dirty check covers the whole repo, not only services/mcp-server.
#
# DEPLOY_DRY_RUN=1 writes the stamp file, prints the working directory and the
# exact command, and exits without invoking gcloud.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STAMP_REL="services/mcp-server/build-info.json"

sha="$(git rev-parse HEAD)"
# --porcelain lists tracked and untracked changes; build-info.json is gitignored
# (so never listed), the pathspec exclusion is belt and braces.
if [ -n "$(git status --porcelain -- . ":(exclude)$STAMP_REL")" ]; then
  sha="${sha}-dirty"
fi
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '{\n  "gitSha": "%s",\n  "buildTime": "%s"\n}\n' "$sha" "$build_time" > "$STAMP_REL"
echo "Stamped $STAMP_REL: gitSha=$sha buildTime=$build_time"

# The deploy command is bare on purpose. DO NOT ADD ANY FLAG.
# In particular --set-env-vars REPLACES the service's whole env map and would
# wipe production configuration (docs/deployment.md).
DEPLOY_CMD=(gcloud run deploy cachebash-mcp --source . --region us-central1 --project cachebash-app)

DEPLOY_DIR="$REPO_ROOT/services/mcp-server"
cd "$DEPLOY_DIR"

if [ "${DEPLOY_DRY_RUN:-}" = "1" ]; then
  echo "DRY RUN, not executing. cwd: $DEPLOY_DIR"
  echo "command: ${DEPLOY_CMD[*]}"
  exit 0
fi

exec "${DEPLOY_CMD[@]}"
