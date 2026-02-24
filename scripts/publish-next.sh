#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH."
  exit 1
fi

# Optional convenience: load token from local env file if present.
if [[ -f "$ROOT_DIR/packages/core/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/packages/core/.env"
  set +a
fi

TOKEN="${NPM_TOKEN:-${NODE_AUTH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Missing NPM token. Set NPM_TOKEN or NODE_AUTH_TOKEN (or place it in packages/core/.env)."
  exit 1
fi

TMP_NPMRC="$(mktemp)"
trap 'rm -f "$TMP_NPMRC"' EXIT
printf "//registry.npmjs.org/:_authToken=%s\n" "$TOKEN" >"$TMP_NPMRC"
export NPM_CONFIG_USERCONFIG="$TMP_NPMRC"

echo "Checking npm authentication..."
npm whoami >/dev/null
echo "npm authentication OK."

PUBLISH_CMD=(pnpm publish --access public --tag next --no-git-checks)
if [[ "$DRY_RUN" -eq 1 ]]; then
  PUBLISH_CMD+=(--dry-run)
  echo "Dry run mode enabled."
fi

publish_pkg() {
  local pkg="$1"
  echo "Publishing $pkg ..."
  pnpm --filter "$pkg" "${PUBLISH_CMD[@]:1}"
}

# Dependency order matters:
publish_pkg "@valuya/core"
publish_pkg "@valuya/agent"
publish_pkg "@valuya/aws-lambda-node"
publish_pkg "@valuya/cli"

echo "Done."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "No packages were actually published (dry run)."
fi

