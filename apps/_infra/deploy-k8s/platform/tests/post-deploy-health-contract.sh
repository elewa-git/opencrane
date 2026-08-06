#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
VERIFY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/post-deploy-verify.sh"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"
CHART_FIXTURE="$(mktemp -d)"
trap 'rm -rf "$CHART_FIXTURE"' EXIT

grep -Fq 'source "$POST_DEPLOY_VERIFY"' "$DEPLOY_SCRIPT"
source "$VERIFY_SCRIPT"

# Render against the current app-owned server chart, not the potentially stale committed archive.
cp -R "$CHART_DIR/." "$CHART_FIXTURE"
helm package "$ROOT_DIR/apps/opencrane/helm" --destination "$CHART_FIXTURE/charts" >/dev/null
rendered_ingress="$(helm template opencrane-silo "$CHART_FIXTURE" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --show-only templates/app-rollups.yaml)"
health_route="$(awk '
  /          - path: \/healthz/ { capture = 1 }
  capture { print }
  capture && /                  number:/ { exit }
' <<<"$rendered_ingress")"
grep -Fq '          - path: /healthz' <<<"$health_route"
grep -Fq '            pathType: Exact' <<<"$health_route"
grep -Fq '                name: opencrane-silo-opencrane-server' <<<"$health_route"
grep -Fq '                  number: 8080' <<<"$health_route"

rendered_pull_secret="$(helm template opencrane-silo "$CHART_FIXTURE" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set-string 'global.imagePullSecret=opencrane-ghcr-pull' \
  --show-only templates/app-rollups.yaml)"
[[ "$(grep -Fc 'name: "opencrane-ghcr-pull"' <<<"$rendered_pull_secret")" == "3" ]]

_run_verify() {
  local curl_outcome="$1"
  local insecure="$2"
  local missing_curl="${3:-0}"
  local curl_args_file
  curl_args_file="$(mktemp)"

  VERIFY=1
  VERIFY_INSECURE="$insecure"
  NAMESPACE=opencrane-acme
  log() { printf '%s\n' "$*"; }
  warn() { printf '%s\n' "$*"; }
  kubectl() { return 0; }
  dig() { printf '127.0.0.1\n'; }
  _control_plane_hosts() { printf 'acme.opencrane.local\n'; }
  curl() {
    printf '%s\n' "$@" >"$curl_args_file"
    [[ "$curl_outcome" == "healthy" ]]
  }
  command() {
    if [[ "$missing_curl" == "1" && "${1:-}" == "-v" && "${2:-}" == "curl" ]]; then
      return 1
    fi
    builtin command "$@"
  }

  _post_deploy_verify
  cat "$curl_args_file"
  rm -f "$curl_args_file"
}

healthy_output="$(_run_verify healthy 0)"
grep -Fq 'https://acme.opencrane.local/healthz is healthy' <<<"$healthy_output"
grep -Fq -- '--connect-timeout' <<<"$healthy_output"
grep -Fq -- '--max-time' <<<"$healthy_output"
if grep -Fq -- '--insecure' <<<"$healthy_output"; then
  echo "post-deploy health check disables TLS verification by default" >&2
  exit 1
fi

insecure_output="$(_run_verify healthy 1)"
grep -Fq -- '--insecure' <<<"$insecure_output"

unhealthy_output="$(_run_verify unhealthy 0)"
grep -Fq 'https://acme.opencrane.local/healthz is unavailable or unhealthy' <<<"$unhealthy_output"

missing_curl_output="$(_run_verify healthy 0 1)"
grep -Fq 'curl is unavailable — skipping the HTTP health check.' <<<"$missing_curl_output"

echo "post-deploy health contract: PASS"
