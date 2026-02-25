#!/usr/bin/env bash
set -euo pipefail

# Simple markdown hygiene checks without extra dependencies.
fail=0

while IFS= read -r f; do
  if grep -n $'\t' "$f" >/dev/null; then
    echo "tabs found in $f"
    fail=1
  fi
  if grep -n ' $' "$f" >/dev/null; then
    echo "trailing spaces found in $f"
    fail=1
  fi
  if [[ "$f" == "README.md" ]]; then
    grep -q "Canonical contract" "$f" || { echo "README missing canonical contract link"; fail=1; }
    grep -q "LICENSE" "$f" || { echo "README missing LICENSE reference"; fail=1; }
  fi
done < <(
  {
    echo "README.md"
    find docs -name '*.md' 2>/dev/null
    find examples -maxdepth 2 -name 'README.md' 2>/dev/null
    find packages -maxdepth 2 -name 'README.md' 2>/dev/null
    echo "SECURITY.md"
    echo "SUPPORT.md"
    echo "CONTRIBUTING.md"
    echo "CODE_OF_CONDUCT.md"
  } | sort -u
)

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "markdown lint checks passed"
