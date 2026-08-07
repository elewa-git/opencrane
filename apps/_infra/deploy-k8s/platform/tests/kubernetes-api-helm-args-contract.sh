#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO="ipv4"

err() {
  :
}

kubectl() {
  local resource="$2"
  local jsonpath="${*: -1}"

  if [[ "$resource" == "service" ]]; then
    if [[ "$jsonpath" == "jsonpath={.spec.clusterIP}" ]]; then
      case "$SCENARIO" in
        ipv4) printf '10.43.0.1' ;;
        ipv6) printf 'fd00::1' ;;
        missing_service) : ;;
        *) printf '10.43.0.1' ;;
      esac
      return
    fi
    printf '443'
    return
  fi

  if [[ "$jsonpath" == "jsonpath={.subsets[0].ports[0].port}" ]]; then
    printf '6443'
    return
  fi

  case "$SCENARIO" in
    ipv4) printf '172.18.0.2\n172.18.0.3\n' ;;
    ipv6) printf 'fd00::2\n' ;;
    missing_endpoints) : ;;
    *) printf '172.18.0.2\n' ;;
  esac
}

# shellcheck source=../kubernetes-api-helm-args.sh
source "$SCRIPT_DIR/../kubernetes-api-helm-args.sh"

assert_array() {
  local expected="$1"
  local actual
  actual="$(printf '%s\n' "${KUBERNETES_API_HELM_ARGS[@]}")"
  [[ "$actual" == "$expected" ]]
}

SCENARIO="ipv4"
_load_kubernetes_api_helm_args memoryGateway "memory gateway"
assert_array $'--set-string\nmemoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32\n--set\nmemoryGateway.kubernetesApiServerPort=443\n--set\nmemoryGateway.kubernetesApiServerEndpointPort=6443\n--set-string\nmemoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32\n--set-string\nmemoryGateway.kubernetesApiServerEndpointCidrs[1]=172.18.0.3/32'

SCENARIO="ipv6"
_load_kubernetes_api_helm_args agentController "agent controller"
assert_array $'--set-string\nagentController.kubernetesApiServerCidrs[0]=fd00::1/128\n--set\nagentController.kubernetesApiServerPort=443\n--set\nagentController.kubernetesApiServerEndpointPort=6443\n--set-string\nagentController.kubernetesApiServerEndpointCidrs[0]=fd00::2/128'

SCENARIO="missing_service"
if ( _load_kubernetes_api_helm_args memoryGateway "memory gateway" ); then
  echo "expected missing Kubernetes API Service data to fail" >&2
  exit 1
fi

SCENARIO="missing_endpoints"
if ( _load_kubernetes_api_helm_args memoryGateway "memory gateway" ); then
  echo "expected missing Kubernetes API endpoints to fail" >&2
  exit 1
fi

echo "kubernetes-api helm args contract passed"
