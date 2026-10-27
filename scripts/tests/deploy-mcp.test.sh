#!/usr/bin/env bash
# Test: scripts/deploy-mcp.sh runs the bare deploy command from services/mcp-server
# and stamps build-info.json with HEAD. A fake gcloud on PATH records cwd and argv.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
pwd -P > "$FAKE_GCLOUD_OUT/cwd"
printf '%s\n' "$@" > "$FAKE_GCLOUD_OUT/argv"
FAKE
chmod +x "$WORK/bin/gcloud"

STAMP="$REPO_ROOT/services/mcp-server/build-info.json"
rm -f "$STAMP"
trap 'rm -rf "$WORK"; rm -f "$STAMP"' EXIT

FAKE_GCLOUD_OUT="$WORK" PATH="$WORK/bin:$PATH" bash "$REPO_ROOT/scripts/deploy-mcp.sh" > "$WORK/stdout"

fail() { echo "FAIL: $*" >&2; exit 1; }

cwd="$(cat "$WORK/cwd")"
case "$cwd" in
  */services/mcp-server) ;;
  *) fail "gcloud cwd is '$cwd', expected a path ending in services/mcp-server" ;;
esac

expected=$'run\ndeploy\ncachebash-mcp\n--source\n.\n--region\nus-central1\n--project\ncachebash-app'
[ "$(cat "$WORK/argv")" = "$expected" ] || fail "argv differs: $(tr '\n' ' ' < "$WORK/argv")"

[ -f "$STAMP" ] || fail "build-info.json missing"
head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
grep -q "\"gitSha\": \"$head_sha\(-dirty\)\?\"" "$STAMP" || fail "build-info.json gitSha is not HEAD $head_sha: $(cat "$STAMP")"

echo "PASS: cwd=$cwd, argv exact, build-info.json gitSha=$head_sha"
