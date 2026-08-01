#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
AMBIENT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-ambient-chart.XXXXXX")"
AMBIENT_FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-ambient-fixture.XXXXXX")"
CALLS="$(mktemp)"
FAILURE_CHART="$(mktemp)"
REAL_HELM="$(command -v helm)"
trap 'rm -rf -- "$AMBIENT_DIR" "$AMBIENT_FIXTURE"; rm -f "$CALLS" "$FAILURE_CHART"' EXIT

touch "$AMBIENT_FIXTURE/must-survive"
export OPENCRANE_DEPLOY_K8S_CHART_DIR="$AMBIENT_DIR"
export OPENCRANE_DEPLOY_K8S_CHART_FIXTURE="$AMBIENT_FIXTURE"
source "$HELPER"

helm()
{
  printf '%s\n' "$*" >>"$CALLS"
  "$REAL_HELM" "$@"
}

prepare_current_chart_sources
prepared_chart="$(current_chart_sources_dir)"
[[ "$prepared_chart" != "$AMBIENT_DIR" ]]
grep -Fq 'dependency build --skip-refresh' "$CALLS"
[[ -L "$prepared_chart/../../opencrane" ]]
cleanup_current_chart_sources
[[ -f "$AMBIENT_FIXTURE/must-survive" ]]

helm()
{
  printf '%s\n' "$4" >"$FAILURE_CHART"
  return 42
}

if prepare_current_chart_sources; then
  printf 'Expected dependency build failure.\n' >&2
  exit 1
fi
failed_chart="$(<"$FAILURE_CHART")"
failed_fixture="${failed_chart%/apps/_infra/deploy-k8s}"
[[ "$failed_fixture" != "$failed_chart" ]]
if [[ -e "$failed_fixture" ]]; then
  printf 'Failed dependency build left its fixture behind: %s\n' "$failed_fixture" >&2
  exit 1
fi
[[ -f "$AMBIENT_FIXTURE/must-survive" ]]

echo "current chart sources contract: PASS"
