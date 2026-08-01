#!/usr/bin/env bash
set -euo pipefail

ROOT="$1"
WORKLOAD_REGISTRY="$2"
source "$ROOT/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"

node "$ROOT/scripts/phase-b-render-profiles.mjs" \
  "$ROOT" \
  "$WORKLOAD_REGISTRY" \
  "$CHART_DIR"
