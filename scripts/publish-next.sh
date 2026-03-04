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

# Optional convenience: load env vars from one centralized file: repo root .env
# Keep explicit shell exports higher priority by not overriding existing values.
load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  while IFS='=' read -r raw_key raw_val; do
    [[ -n "$raw_key" ]] || continue
    [[ "$raw_key" =~ ^[[:space:]]*# ]] && continue
    local key
    key="$(echo "$raw_key" | sed -E 's/^[[:space:]]*export[[:space:]]+//;s/[[:space:]]+$//')"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    # Skip if already set in environment.
    if [[ -n "${!key+x}" ]]; then
      continue
    fi

    local val="${raw_val:-}"
    val="${val%$'\r'}"
    val="$(echo "$val" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')"
    if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi
    export "$key=$val"
  done < "$env_file"
}

load_env_file "$ROOT_DIR/.env"

TOKEN="${NPM_TOKEN:-${NODE_AUTH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Missing NPM token. Set NPM_TOKEN (or NODE_AUTH_TOKEN) in shell or root .env."
  exit 1
fi

# Normalize accidental CR/LF and catch malformed token assignments.
TOKEN="$(printf '%s' "$TOKEN" | tr -d '\r\n')"
if [[ "$TOKEN" == NPM_TOKEN=* ]] || [[ "$TOKEN" == NODE_AUTH_TOKEN=* ]]; then
  echo "Malformed token value detected. Set only the raw token string, not KEY=value."
  exit 1
fi
if [[ "$TOKEN" =~ [[:space:]] ]]; then
  echo "Token contains whitespace. Remove spaces/newlines and try again."
  exit 1
fi

# Ensure project .npmrc env substitution always resolves, even if only one var was provided.
export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-$TOKEN}"
export NPM_TOKEN="${NPM_TOKEN:-$TOKEN}"

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
publish_pkg "@valuya/protocol"
publish_pkg "@valuya/agent"
publish_pkg "@valuya/agentokratia-signer"
publish_pkg "@valuya/telegram-bot"
publish_pkg "@valuya/discord-bot"
publish_pkg "@valuya/cloudflare-workers"
publish_pkg "@valuya/fastly-compute"
publish_pkg "@valuya/vercel-edge"
publish_pkg "@valuya/client-js"
publish_pkg "@valuya/node-express"
publish_pkg "@valuya/node-koa"
publish_pkg "@valuya/nextjs"
publish_pkg "@valuya/nestjs"
publish_pkg "@valuya/hono"
publish_pkg "@valuya/aws-lambda-node"
publish_pkg "@valuya/kubernetes"
publish_pkg "@valuya/nginx-auth-request"
publish_pkg "@valuya/reverse-proxy"
publish_pkg "@valuya/cli"

echo "Done."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "No packages were actually published (dry run)."
fi
