#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"

helm lint "$CHART_DIR"
