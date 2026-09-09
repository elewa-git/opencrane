#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
VERIFY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/post-deploy-verify.sh"
grep -Fq 'source "$POST_DEPLOY_VERIFY"' "$DEPLOY_SCRIPT"
source "$VERIFY_SCRIPT"

# The shared fixture packages every current app-owned chart source, the same way deploy.sh does.
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
prepare_current_chart_sources
trap 'cleanup_current_chart_sources' EXIT
CHART_FIXTURE="$(current_chart_sources_dir)"
echo "[health] render ingress"
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

echo "[health] render server deployment"
server_deployment="$(helm template opencrane-silo "$CHART_FIXTURE" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --show-only templates/app-rollups.yaml | awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-silo-opencrane-server/ { print }')"
[[ -n "$server_deployment" ]]
grep -Fq 'livenessProbe:' <<<"$server_deployment"
grep -Fq 'tcpSocket:' <<<"$server_deployment"
if awk '/livenessProbe:/,/readinessProbe:/' <<<"$server_deployment" | grep -Fq 'path: /healthz'; then
  echo "server liveness must not depend on the database-backed health route" >&2
  exit 1
fi
grep -Fq 'readinessProbe:' <<<"$server_deployment"
grep -Fq 'path: /healthz' <<<"$server_deployment"

echo "[health] render spa deployment"
spa_deployment="$(helm template opencrane-silo "$CHART_FIXTURE" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set-string 'controlPlaneSpa.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --show-only templates/app-rollups.yaml | awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-silo-opencrane-ui-spa/ { print }')"
[[ -n "$spa_deployment" ]]
grep -Fq 'image: "ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' <<<"$spa_deployment"
grep -Fq 'livenessProbe:' <<<"$spa_deployment"
grep -Fq 'readinessProbe:' <<<"$spa_deployment"

echo "[health] render pull secret"
rendered_pull_secret="$(helm template opencrane-silo "$CHART_FIXTURE" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set-string 'global.imagePullSecret=opencrane-ghcr-pull' \
  --show-only templates/app-rollups.yaml)"
# Every image-pulling deployable the umbrella renders must carry the shared pull secret: the server
# and the memory gateway. Name them instead of counting, so a removed or added deployable is a
# deliberate edit here rather than a silent count drift.
for pulling_deployment in opencrane-silo-opencrane-server opencrane-silo-memory-gateway; do
  pulling_document="$(awk -v name="$pulling_deployment" 'BEGIN { RS="---" } /kind: Deployment/ && index($0, "name: " name) { print }' <<<"$rendered_pull_secret")"
  [[ -n "$pulling_document" ]]
  grep -Fq 'name: "opencrane-ghcr-pull"' <<<"$pulling_document"
done
[[ "$(grep -Fc 'name: "opencrane-ghcr-pull"' <<<"$rendered_pull_secret")" == "2" ]]

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
  grep -Fq '_wait_for_release_certificate' "$DEPLOY_SCRIPT"
  grep -Fq 'kubectl wait --for=condition=Ready "certificate/$certificate" -n "$NAMESPACE" --timeout="${TIMEOUT}s"' "$VERIFY_SCRIPT"
  grep -Fq '[[ "$lookup" != *"(NotFound)"* ]]' "$VERIFY_SCRIPT"
  cat "$curl_args_file"
  rm -f "$curl_args_file"
}

echo "[health] verify healthy"
healthy_output="$(_run_verify healthy 0)"
grep -Fq 'https://acme.opencrane.local/healthz is healthy' <<<"$healthy_output"
grep -Fq -- '--connect-timeout' <<<"$healthy_output"
grep -Fq -- '--max-time' <<<"$healthy_output"
if grep -Fq -- '--insecure' <<<"$healthy_output"; then
  echo "post-deploy health check disables TLS verification by default" >&2
  exit 1
fi

echo "[health] verify insecure"
insecure_output="$(_run_verify healthy 1)"
grep -Fq -- '--insecure' <<<"$insecure_output"

echo "[health] verify unhealthy"
unhealthy_output="$(_run_verify unhealthy 0)"
grep -Fq 'https://acme.opencrane.local/healthz is unavailable or unhealthy' <<<"$unhealthy_output"

echo "[health] verify missing curl"
missing_curl_output="$(_run_verify healthy 0 1)"
grep -Fq 'curl is unavailable — skipping the HTTP health check.' <<<"$missing_curl_output"

_verify_spa_rollout()
{
  local result
  CONTROL_PLANE_SPA_IMAGE="ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  NAMESPACE=opencrane-acme
  RELEASE=opencrane-silo
  log() { printf '%s\n' "$*"; }
  err() { printf '%s\n' "$*" >&2; }
  kubectl()
  {
    if [[ "$*" == *'get deployment/opencrane-silo-opencrane-ui-spa'* ]]; then
      cat <<'JSON'
{"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"opencrane-ui-spa","image":"ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]} }},"status":{"updatedReplicas":1,"readyReplicas":1,"availableReplicas":1,"unavailableReplicas":0,"conditions":[{"type":"Available","status":"True","reason":"MinimumReplicasAvailable","message":"Deployment has minimum availability."}]}}
JSON
    elif [[ "$*" == *'get pods'* ]]; then
      cat <<'JSON'
{"items":[{"status":{"containerStatuses":[{"name":"opencrane-ui-spa","imageID":"ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}}]}
JSON
    else
      printf 'unexpected kubectl call: %s\n' "$*" >&2
      return 1
    fi
  }
  result="$(_verify_control_plane_spa_rollout)"
  grep -Fq 'desired image=ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' <<<"$result"
  grep -Fq 'observed image IDs: ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' <<<"$result"
}

echo "[health] verify spa rollout"
_verify_spa_rollout

if (
  CONTROL_PLANE_SPA_IMAGE="ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  NAMESPACE=opencrane-acme
  RELEASE=opencrane-silo
  log() { :; }
  err() { :; }
  kubectl()
  {
    if [[ "$*" == *'get deployment/opencrane-silo-opencrane-ui-spa'* ]]; then
      printf '%s\n' '{"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"opencrane-ui-spa","image":"ghcr.io/elewa-git/opencrane-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}}},"status":{"updatedReplicas":1,"readyReplicas":1,"availableReplicas":1,"unavailableReplicas":0}}'
    elif [[ "$*" == *'get pods'* ]]; then
      printf '%s\n' '{"items":[{"status":{"containerStatuses":[{"name":"opencrane-ui-spa","imageID":"ghcr.io/elewa-git/opencrane-ui@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}}]}'
    else
      return 1
    fi
  }
  _verify_control_plane_spa_rollout
); then
  echo "SPA rollout verification accepted a mismatched image" >&2
  exit 1
fi

_verify_cognee_rollout_contract()
{
  local result
  COGNEE_IMAGE="ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  NAMESPACE=opencrane-acme
  RELEASE=opencrane-silo
  log() { printf '%s\n' "$*"; }
  err() { printf '%s\n' "$*" >&2; }
  kubectl()
  {
    if [[ "$*" == *'get deployment/opencrane-silo-cognee'* ]]; then
      cat <<'JSON'
{"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"cognee","image":"ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}}},"status":{"updatedReplicas":1,"readyReplicas":1,"availableReplicas":1,"unavailableReplicas":0,"conditions":[{"type":"Available","status":"True","reason":"MinimumReplicasAvailable","message":"Deployment has minimum availability."}]}}
JSON
    elif [[ "$*" == *'get pods'* ]]; then
      cat <<'JSON'
{"items":[{"status":{"containerStatuses":[{"name":"cognee","imageID":"ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}}]}
JSON
    else
      printf 'unexpected kubectl call: %s\n' "$*" >&2
      return 1
    fi
  }
  result="$(_verify_cognee_rollout)"
  grep -Fq 'Cognee rollout: desired image=ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' <<<"$result"
  grep -Fq 'Cognee observed image IDs: ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' <<<"$result"
}

_verify_cognee_rollout_contract

if (
  COGNEE_IMAGE="ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  NAMESPACE=opencrane-acme
  RELEASE=opencrane-silo
  log() { :; }
  err() { :; }
  kubectl()
  {
    if [[ "$*" == *'get deployment/opencrane-silo-cognee'* ]]; then
      printf '%s\n' '{"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"cognee","image":"ghcr.io/elewa-git/opencrane-cognee@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}}},"status":{"updatedReplicas":1,"readyReplicas":1,"availableReplicas":1,"unavailableReplicas":0}}'
    elif [[ "$*" == *'get pods'* ]]; then
      printf '%s\n' '{"items":[{"status":{"containerStatuses":[{"name":"cognee","imageID":"ghcr.io/elewa-git/opencrane-cognee@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]}}]}'
    else
      return 1
    fi
  }
  _verify_cognee_rollout
); then
  echo "Cognee rollout verification accepted a mismatched image" >&2
  exit 1
fi

echo "post-deploy health contract: PASS"
echo "post-deploy health contract: PASS"
