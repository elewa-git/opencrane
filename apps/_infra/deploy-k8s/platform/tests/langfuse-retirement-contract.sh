#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
CONFIGURE_OIDC_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/configure-oidc.sh"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

cat >"$FAKE_BIN/helm" <<'SCRIPT'
#!/usr/bin/env bash
if [[ " $* " == *" status "* ]]; then
  if [[ "${FAKE_HELM_MODE:-}" == "status-error" ]]; then
    printf '%s\n' 'forbidden: cannot read release' >&2
    exit 1
  fi
  if [[ "${FAKE_HELM_MODE:-}" == "missing" ]]; then
    printf '%s\n' 'Error: release: not found' >&2
    exit 1
  fi
  exit 0
fi
if [[ " $* " == *" get manifest "* ]]; then
  if [[ "${FAKE_HELM_MODE:-}" == "manifest-error" ]]; then
    printf '%s\n' 'forbidden: cannot read manifest' >&2
    exit 1
  fi
  if [[ "${FAKE_HELM_MODE:-}" == "clean" ]]; then
    printf '%s\n' '# Source: opencrane/templates/app-rollups.yaml'
    exit 0
  fi
  printf '%s\n' '# Source: opencrane/charts/langfuse/templates/web/deployment.yaml'
  exit 0
fi
exit 0
SCRIPT

cat >"$FAKE_BIN/kubectl" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "$1" == "cluster-info" ]]; then
  exit 0
fi
if [[ "$1 $2" == "get storageclass" && $# -eq 2 ]]; then
  printf '%s\n' 'standard	true'
  exit 0
fi
if [[ "$1 $2 $3" == "get storageclass standard" ]]; then
  printf '%s' 'true'
  exit 0
fi
if [[ "$1 $2" == "config current-context" ]]; then
  printf '%s\n' 'fake-context'
  exit 0
fi
exit 1
SCRIPT

chmod +x "$FAKE_BIN/helm" "$FAKE_BIN/kubectl"

set +e
blocked_output="$(PATH="$FAKE_BIN:$PATH" OPENCRANE_CHART_DIR="$CHART_DIR" bash "$DEPLOY_SCRIPT" 2>&1)"
blocked_status=$?
set -e
if [[ $blocked_status -eq 0 ]]; then
  echo "Langfuse-enabled upgrade was not blocked." >&2
  exit 1
fi
grep -Fq "Existing release 'opencrane' still contains Langfuse" <<<"$blocked_output"
grep -Fq -- '--confirm-langfuse-retirement-after-backup' <<<"$blocked_output"

set +e
oidc_output="$(PATH="$FAKE_BIN:$PATH" OPENCRANE_CHART_DIR="$CHART_DIR" \
  bash "$CONFIGURE_OIDC_SCRIPT" --disable 2>&1)"
oidc_status=$?
set -e
if [[ $oidc_status -eq 0 ]]; then
  echo "OIDC configurator crossed the Langfuse retirement boundary." >&2
  exit 1
fi
grep -Fq "still contains legacy Langfuse resources" <<<"$oidc_output"
grep -Fq -- 'deploy.sh --confirm-langfuse-retirement-after-backup' <<<"$oidc_output"

set +e
status_error_output="$(PATH="$FAKE_BIN:$PATH" FAKE_HELM_MODE=status-error \
  OPENCRANE_CHART_DIR="$CHART_DIR" bash "$DEPLOY_SCRIPT" 2>&1)"
status_error_status=$?
set -e
if [[ $status_error_status -eq 0 ]]; then
  echo "Helm status error failed open." >&2
  exit 1
fi
grep -Fq "Cannot determine whether Helm release 'opencrane' exists" <<<"$status_error_output"

set +e
manifest_error_output="$(PATH="$FAKE_BIN:$PATH" FAKE_HELM_MODE=manifest-error \
  OPENCRANE_CHART_DIR="$CHART_DIR" bash "$DEPLOY_SCRIPT" 2>&1)"
manifest_error_status=$?
set -e
if [[ $manifest_error_status -eq 0 ]]; then
  echo "Helm manifest error failed open." >&2
  exit 1
fi
grep -Fq "Cannot read the existing Helm manifest for 'opencrane'" <<<"$manifest_error_output"

set +e
clean_output="$(PATH="$FAKE_BIN:$PATH" FAKE_HELM_MODE=clean \
  OPENCRANE_CHART_DIR="$CHART_DIR" bash "$DEPLOY_SCRIPT" 2>&1)"
clean_status=$?
set -e
if [[ $clean_status -eq 0 ]]; then
  echo "Clean-manifest simulation unexpectedly completed the full deploy." >&2
  exit 1
fi
if grep -Fq 'Langfuse retirement' <<<"$clean_output"; then
  echo "A clean existing manifest was incorrectly treated as a Langfuse retirement." >&2
  exit 1
fi

set +e
missing_output="$(PATH="$FAKE_BIN:$PATH" FAKE_HELM_MODE=missing \
  OPENCRANE_CHART_DIR="$CHART_DIR" bash "$DEPLOY_SCRIPT" 2>&1)"
missing_status=$?
set -e
if [[ $missing_status -eq 0 ]]; then
  echo "Missing-release simulation unexpectedly completed the full deploy." >&2
  exit 1
fi
if grep -Fq 'Langfuse retirement' <<<"$missing_output"; then
  echo "An authoritative missing release was incorrectly treated as a Langfuse retirement." >&2
  exit 1
fi

set +e
confirmed_output="$(PATH="$FAKE_BIN:$PATH" OPENCRANE_CHART_DIR="$CHART_DIR" \
  bash "$DEPLOY_SCRIPT" --confirm-langfuse-retirement-after-backup 2>&1)"
confirmed_status=$?
set -e
if [[ $confirmed_status -eq 0 ]]; then
  echo "Retirement simulation unexpectedly completed the full deploy." >&2
  exit 1
fi
grep -Fq 'Langfuse retirement explicitly confirmed after backup.' <<<"$confirmed_output"
if grep -Fq "Existing release 'opencrane' still contains Langfuse" <<<"$confirmed_output"; then
  echo "Explicit retirement confirmation did not clear the fail-closed gate." >&2
  exit 1
fi

echo "legacy Langfuse retirement gate contract: PASS"
