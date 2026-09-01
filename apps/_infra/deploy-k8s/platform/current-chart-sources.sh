#!/usr/bin/env bash

# Builds the umbrella's file dependencies in a disposable chart tree. Contract
# checks must render the same current app-owned sources as deploy.sh, but must
# never leave timestamp-only archive churn in the checkout.

_CURRENT_CHART_SOURCES_FIXTURE=""
_CURRENT_CHART_SOURCES_TOKEN=""
_CURRENT_CHART_SOURCES_DIR=""

current_chart_sources_root()
{
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd
}

# This helper rebuilds the ignored subchart archives before a contract render. Helm reuses an archive
# at the same version even after its file dependency changes, so a rebuild keeps the render on the
# checked-out chart sources.
ensure_umbrella_chart_dependencies()
{
  local umbrella
  umbrella="$(current_chart_sources_root)/apps/_infra/deploy-k8s"
  rm -rf -- "$umbrella/charts"
  rm -f -- "$umbrella/Chart.lock"
  helm dependency update --skip-refresh "$umbrella" >/dev/null
}

prepare_current_chart_sources()
{
  if [[ -n "$_CURRENT_CHART_SOURCES_FIXTURE" ]]; then
    printf 'Current chart sources are already prepared by this shell.\n' >&2
    return 1
  fi

  local root fixture_apps temp_parent fixture_name marker
  root="$(current_chart_sources_root)"
  temp_parent="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  _CURRENT_CHART_SOURCES_FIXTURE="$(mktemp -d "$temp_parent/opencrane-deploy-k8s-chart.XXXXXX")"
  fixture_name="$(basename "$_CURRENT_CHART_SOURCES_FIXTURE")"
  if [[ "$(dirname "$_CURRENT_CHART_SOURCES_FIXTURE")" != "$temp_parent" \
    || ! "$fixture_name" =~ ^opencrane-deploy-k8s-chart\.[[:alnum:]]{6}$ ]]; then
    printf 'mktemp returned an invalid chart fixture path: %s\n' "$_CURRENT_CHART_SOURCES_FIXTURE" >&2
    _CURRENT_CHART_SOURCES_FIXTURE=""
    return 1
  fi

  _CURRENT_CHART_SOURCES_TOKEN="$fixture_name:$$:$RANDOM$RANDOM"
  marker="$_CURRENT_CHART_SOURCES_FIXTURE/.opencrane-chart-fixture-owner"
  printf '%s\n' "$_CURRENT_CHART_SOURCES_TOKEN" >"$marker"
  fixture_apps="$_CURRENT_CHART_SOURCES_FIXTURE/apps"
  _CURRENT_CHART_SOURCES_DIR="$fixture_apps/_infra/deploy-k8s"

  if ! (
    mkdir -p "$fixture_apps/_infra"
    cp -R "$root/apps/_infra/deploy-k8s" "$_CURRENT_CHART_SOURCES_DIR"

    # Keep the dependency layout identical to Chart.yaml while linking every
    # app-owned source directory. New local dependencies then need no fixture
    # maintenance. Every dependency is an in-repo file:// chart, so the checked-out
    # commit is the reproducibility authority and the update packages the current
    # sources fresh — no lock file or vendored archive to keep in step.
    for app_dir in "$root/apps"/*; do
      [[ "$(basename "$app_dir")" == "_infra" ]] && continue
      ln -s "$app_dir" "$fixture_apps/$(basename "$app_dir")"
    done
    for infra_dir in "$root/apps/_infra"/*; do
      [[ "$(basename "$infra_dir")" == "deploy-k8s" ]] && continue
      ln -s "$infra_dir" "$fixture_apps/_infra/$(basename "$infra_dir")"
    done

    helm dependency update --skip-refresh "$_CURRENT_CHART_SOURCES_DIR" >/dev/null
  ); then
    cleanup_current_chart_sources
    return 1
  fi
}

current_chart_sources_dir()
{
  if [[ -z "$_CURRENT_CHART_SOURCES_DIR" ]]; then
    printf 'Current chart sources have not been prepared.\n' >&2
    return 1
  fi
  printf '%s\n' "$_CURRENT_CHART_SOURCES_DIR"
}

cleanup_current_chart_sources()
{
  local fixture marker marker_token temp_parent fixture_name
  fixture="$_CURRENT_CHART_SOURCES_FIXTURE"
  if [[ -z "$fixture" ]]; then
    return
  fi

  temp_parent="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  fixture_name="$(basename "$fixture")"
  marker="$fixture/.opencrane-chart-fixture-owner"
  marker_token=""
  if [[ -f "$marker" ]]; then
    IFS= read -r marker_token <"$marker"
  fi
  if [[ "$(dirname "$fixture")" != "$temp_parent" \
    || ! "$fixture_name" =~ ^opencrane-deploy-k8s-chart\.[[:alnum:]]{6}$ \
    || "$marker_token" != "$_CURRENT_CHART_SOURCES_TOKEN" ]]; then
    printf 'Refusing to remove an unowned chart fixture: %s\n' "$fixture" >&2
    return 1
  fi

  _CURRENT_CHART_SOURCES_FIXTURE=""
  _CURRENT_CHART_SOURCES_TOKEN=""
  _CURRENT_CHART_SOURCES_DIR=""
  rm -rf -- "$fixture"
}
