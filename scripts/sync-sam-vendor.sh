#!/usr/bin/env bash
set -euo pipefail

rm -rf sam-app/vendor/core sam-app/vendor/aws-lambda-node
mkdir -p sam-app/vendor

# Copy source packages into sam vendor
cp -R packages/core sam-app/vendor/core
cp -R packages/aws-lambda-node sam-app/vendor/aws-lambda-node

# Optional: remove node_modules if present
rm -rf sam-app/vendor/core/node_modules sam-app/vendor/aws-lambda-node/node_modules

echo "Synced vendor packages into sam-app/vendor/"
