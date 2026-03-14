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

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  while IFS='=' read -r raw_key raw_val; do
    [[ -n "$raw_key" ]] || continue
    [[ "$raw_key" =~ ^[[:space:]]*# ]] && continue
    local key
    key="$(echo "$raw_key" | sed -E 's/^[[:space:]]*export[[:space:]]+//;s/[[:space:]]+$//')"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

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

TOKEN="$(printf '%s' "$TOKEN" | tr -d '\r\n')"
if [[ "$TOKEN" == NPM_TOKEN=* ]] || [[ "$TOKEN" == NODE_AUTH_TOKEN=* ]]; then
  echo "Malformed token value detected. Set only the raw token string, not KEY=value."
  exit 1
fi
if [[ "$TOKEN" =~ [[:space:]] ]]; then
  echo "Token contains whitespace. Remove spaces/newlines and try again."
  exit 1
fi

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

publish_pkg "@valuya/channel-access-core"
publish_pkg "@valuya/bot-channel-core"
publish_pkg "@valuya/bot-channel-app-core"
publish_pkg "@valuya/bot-channel-server-core"
publish_pkg "@valuya/bot-channel-bootstrap-core"
publish_pkg "@valuya/whatsapp-channel-access"
publish_pkg "@valuya/telegram-channel-access"
publish_pkg "@valuya/whatsapp-bot-channel"
publish_pkg "@valuya/telegram-bot-channel"

echo "Done."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "No packages were actually published (dry run)."
fi
