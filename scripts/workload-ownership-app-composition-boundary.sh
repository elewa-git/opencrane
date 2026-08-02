#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKLOAD_REGISTRY="${WORKLOAD_OWNERSHIP_REGISTRY:-$ROOT/docs/agents/workload-ownership.json}"
APP_SOURCE_REGISTRY="${APP_COMPOSITION_SOURCE_REGISTRY:-$ROOT/docs/agents/app-source-allowlist.json}"

node "$ROOT/scripts/workload-ownership-app-composition-boundary.mjs" \
  "$ROOT" "$WORKLOAD_REGISTRY" "$APP_SOURCE_REGISTRY"
