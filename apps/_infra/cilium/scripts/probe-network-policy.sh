#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]
then
  echo "Usage: probe-network-policy.sh [--namespace NAME]"
  exit 0
fi

PROBE_NAMESPACE=""
if [[ "${1:-}" == "--namespace" && -n "${2:-}" ]]
then
  PROBE_NAMESPACE="$2"
  shift 2
fi
[[ $# -eq 0 ]] || { echo "Usage: probe-network-policy.sh [--namespace NAME]" >&2; exit 1; }

PROBE_NAMESPACE="${PROBE_NAMESPACE:-opencrane-cilium-probe-${RANDOM}-${RANDOM}}"
SERVER_IMAGE="${CILIUM_PROBE_SERVER_IMAGE:-registry.k8s.io/e2e-test-images/agnhost@sha256:99c6b4bb4a1e1df3f0b3752168c89358794d02258ebebc26bf21c29399011a85}"
CLIENT_IMAGE="${CILIUM_PROBE_CLIENT_IMAGE:-quay.io/cilium/alpine-curl:v1.10.0@sha256:913e8c9f3d960dde03882defa0edd3a919d529c2eb167caa7f54194528bde364}"
TIMEOUT_SECONDS="${CILIUM_PROBE_TIMEOUT_SECONDS:-120}"
CLEANED=0

function _cleanup()
{
  [[ "$CLEANED" == "1" ]] && return
  kubectl delete namespace "$PROBE_NAMESPACE" --wait=false >/dev/null 2>&1 || true
}

function _fail()
{
  echo "[cilium-probe] $1" >&2
  exit 1
}

trap _cleanup EXIT

kubectl create namespace "$PROBE_NAMESPACE"

function _create_probe_pod()
{
  local name="$1"
  local role="$2"
  local image="$3"
  local command="$4"

  kubectl apply --namespace "$PROBE_NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    opencrane.io/cilium-probe: ${role}
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: ${image}
      command: ${command}
EOF
}

_create_probe_pod target target "$SERVER_IMAGE" '["/agnhost", "netexec", "--http-port=8080"]'
_create_probe_pod allowed allowed "$CLIENT_IMAGE" '["/bin/sh", "-c", "while true; do sleep 3600; done"]'
_create_probe_pod denied denied "$CLIENT_IMAGE" '["/bin/sh", "-c", "while true; do sleep 3600; done"]'

kubectl apply --namespace "$PROBE_NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: target
spec:
  selector:
    opencrane.io/cilium-probe: target
  ports:
    - port: 8080
      targetPort: 8080
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: only-allowed-client
spec:
  endpointSelector:
    matchLabels:
      opencrane.io/cilium-probe: target
  ingress:
    - fromEndpoints:
        - matchLabels:
            opencrane.io/cilium-probe: allowed
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
EOF

for pod in target allowed denied
do
  kubectl wait --namespace "$PROBE_NAMESPACE" --for=condition=Ready "pod/$pod" --timeout="${TIMEOUT_SECONDS}s"
done

kubectl exec --namespace "$PROBE_NAMESPACE" allowed -- curl --fail --silent --show-error --max-time 5 http://target:8080/ >/dev/null || _fail "Cilium denied the explicitly allowed client"
if kubectl exec --namespace "$PROBE_NAMESPACE" denied -- curl --fail --silent --show-error --max-time 5 http://target:8080/ >/dev/null
then
  _fail "Cilium allowed the denied client"
fi

kubectl delete namespace "$PROBE_NAMESPACE" --wait --timeout="${TIMEOUT_SECONDS}s"
CLEANED=1
echo "[cilium-probe] allow/deny enforcement passed"
