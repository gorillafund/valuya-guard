#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="${1:-.}"
shift || true

if [[ "$#" -eq 0 ]]; then
  exit 0
fi

cd "$PKG_DIR"
mkdir -p node_modules/@valuya

for dep in "$@"; do
  if [[ -d "../${dep}" ]]; then
    ln -snf "../../../${dep}" "node_modules/@valuya/${dep}"
  fi
done
