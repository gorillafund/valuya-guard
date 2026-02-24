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

# Optional convenience: load token from local env file if present.
if [[ -f "$ROOT_DIR/packages/core/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/packages/core/.env"
  set +a
fi

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
