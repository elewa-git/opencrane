#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKLOAD_REGISTRY="${WORKLOAD_OWNERSHIP_REGISTRY:-$ROOT/docs/agents/workload-ownership.json}"
APP_SOURCE_REGISTRY="${APP_COMPOSITION_SOURCE_REGISTRY:-$ROOT/docs/agents/app-source-allowlist.json}"
source "$ROOT/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CURRENT_CHART_DIR="$(current_chart_sources_dir)"

node "$ROOT/scripts/workload-ownership-app-composition-boundary.mjs" \
  "$ROOT" "$WORKLOAD_REGISTRY" "$APP_SOURCE_REGISTRY" "$CURRENT_CHART_DIR"
