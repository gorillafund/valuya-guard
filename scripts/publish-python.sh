#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not found in PATH."
  exit 1
fi

if ! python3 -c "import build" >/dev/null 2>&1; then
  echo "Python package 'build' is required. Install with: python3 -m pip install build twine"
  exit 1
fi

if ! python3 -c "import twine" >/dev/null 2>&1; then
  echo "Python package 'twine' is required. Install with: python3 -m pip install build twine"
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

TOKEN="${PYPI_TOKEN:-${TWINE_PASSWORD:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Missing PyPI token. Set PYPI_TOKEN (or TWINE_PASSWORD) and TWINE_USERNAME=__token__."
  exit 1
fi

export TWINE_USERNAME="${TWINE_USERNAME:-__token__}"
export TWINE_PASSWORD="$TOKEN"

publish_pkg() {
  local pkg_dir="$1"
  echo "Publishing Python package in $pkg_dir ..."

  rm -rf "$pkg_dir/dist" "$pkg_dir/build" "$pkg_dir"/*.egg-info
  python3 -m build "$pkg_dir"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    python3 -m twine check "$pkg_dir"/dist/*
    echo "Dry run: skipped upload for $pkg_dir"
  else
    python3 -m twine upload "$pkg_dir"/dist/*
  fi
}

publish_pkg "packages/aws-lambda-python"
publish_pkg "packages/fastapi"
publish_pkg "packages/django"

echo "Done."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "No Python packages were actually published (dry run)."
fi
