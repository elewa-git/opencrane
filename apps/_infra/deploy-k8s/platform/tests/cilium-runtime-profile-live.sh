#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-opencrane-cilium-runtime-profiles-$RANDOM-$RANDOM}"
RELEASE_NAME="${RELEASE_NAME:-opencrane-cilium-profiles}"
NAMESPACE="${NAMESPACE:-opencrane-cilium-profiles-$RANDOM-$RANDOM}"
ARTIFACT_NAMESPACE="${NAMESPACE}-artifacts"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-180}"
CLIENT_IMAGE="${CILIUM_PROBE_CLIENT_IMAGE:-quay.io/cilium/alpine-curl:v1.10.0@sha256:913e8c9f3d960dde03882defa0edd3a919d529c2eb167caa7f54194528bde364}"
SERVER_IMAGE="${CILIUM_PROBE_SERVER_IMAGE:-registry.k8s.io/e2e-test-images/agnhost@sha256:99c6b4bb4a1e1df3f0b3752168c89358794d02258ebebc26bf21c29399011a85}"
MANIFEST="$(mktemp)"
POLICIES="$(mktemp)"
PREVIOUS_CONTEXT=""
CLUSTER_CREATED=0

function _fail()
{
  echo "[cilium-runtime-profiles] $1" >&2
  exit 1
}

function _require_cmd()
{
  command -v "$1" >/dev/null 2>&1 || _fail "required command is missing: $1"
}

function _cleanup()
{
  local exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    kubectl get pods,ciliumnetworkpolicies -A -o wide 2>/dev/null || true
  fi
  rm -f "$MANIFEST" "$POLICIES"
  if [[ "$CLUSTER_CREATED" == "1" ]]; then
    k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -n "$PREVIOUS_CONTEXT" ]]; then
    kubectl config use-context "$PREVIOUS_CONTEXT" >/dev/null 2>&1 || true
  fi
}

function _wait_ready()
{
  kubectl wait --namespace "$1" --for=condition=Ready "pod/$2" --timeout="${TIMEOUT_SECONDS}s"
}

function _create_client()
{
  local namespace="$1"
  local name="$2"
  local service_account="$3"
  local component="$4"

  kubectl apply --namespace "$namespace" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: opencrane
    app.kubernetes.io/instance: ${RELEASE_NAME}
    app.kubernetes.io/component: ${component}
spec:
  serviceAccountName: ${service_account}
  automountServiceAccountToken: false
  containers:
    - name: client
      image: ${CLIENT_IMAGE}
      command: ["/bin/sh", "-c", "while true; do sleep 3600; done"]
EOF
}

function _create_service_accounts()
{
  kubectl create namespace "$NAMESPACE"
  kubectl create namespace "$ARTIFACT_NAMESPACE"

  for service_account in "${RELEASE_NAME}-opencrane-server" "${RELEASE_NAME}-agent-controller" agent-runtime "${RELEASE_NAME}-channel-proxy" controller-spoof not-server
  do
    kubectl create serviceaccount "$service_account" --namespace "$NAMESPACE"
  done
  kubectl create serviceaccount "${RELEASE_NAME}-artifact-service" --namespace "$ARTIFACT_NAMESPACE"
}

function _render_and_apply_policies()
{
  helm dependency build "$ROOT_DIR/apps/_infra/deploy-k8s" >/dev/null
  helm template "$RELEASE_NAME" "$ROOT_DIR/apps/_infra/deploy-k8s" \
    --namespace "$NAMESPACE" \
    --set agentRuntime.enabled=true \
    --set agentController.enabled=true \
    --set agentController.runtimeImage=example.invalid/opencrane-agent-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string agentController.kubernetesApi.cidr=10.96.0.1/32 \
    --set artifactService.namespace="$ARTIFACT_NAMESPACE" >"$MANIFEST"

  awk 'BEGIN { RS = "---"; ORS = "---\n" } /kind: CiliumNetworkPolicy/ { print }' "$MANIFEST" >"$POLICIES"
  grep -q 'kind: CiliumNetworkPolicy' "$POLICIES" || _fail "rendered app policies are absent"
  kubectl apply -f "$POLICIES"
}

function _create_fixture_workloads()
{
  kubectl apply --namespace "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: server
  labels:
    app.kubernetes.io/name: opencrane
    app.kubernetes.io/instance: ${RELEASE_NAME}
    app.kubernetes.io/component: opencrane-server
spec:
  serviceAccountName: ${RELEASE_NAME}-opencrane-server
  automountServiceAccountToken: false
  containers:
    - name: internal
      image: ${SERVER_IMAGE}
      args: ["netexec", "--http-port=8081"]
    - name: public
      image: ${SERVER_IMAGE}
      args: ["netexec", "--http-port=8080"]
    - name: client
      image: ${CLIENT_IMAGE}
      command: ["/bin/sh", "-c", "while true; do sleep 3600; done"]
---
apiVersion: v1
kind: Service
metadata:
  name: server
spec:
  selector:
    app.kubernetes.io/component: opencrane-server
  ports:
    - name: public
      port: 8080
      targetPort: 8080
    - name: internal
      port: 8081
      targetPort: 8081
EOF

  kubectl apply --namespace "$ARTIFACT_NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: artifact
  labels:
    app.kubernetes.io/name: opencrane
    app.kubernetes.io/instance: ${RELEASE_NAME}
    app.kubernetes.io/component: artifact-service
spec:
  serviceAccountName: ${RELEASE_NAME}-artifact-service
  automountServiceAccountToken: false
  containers:
    - name: http
      image: ${SERVER_IMAGE}
      args: ["netexec", "--http-port=8080"]
    - name: dns
      image: ${CLIENT_IMAGE}
      command: ["/bin/sh", "-c", "while true; do sleep 3600; done"]
---
apiVersion: v1
kind: Service
metadata:
  name: artifact
spec:
  selector:
    app.kubernetes.io/component: artifact-service
  ports:
    - port: 8080
      targetPort: 8080
EOF

  _create_client "$NAMESPACE" controller "${RELEASE_NAME}-agent-controller" agent-controller
  _create_client "$NAMESPACE" runtime agent-runtime agent-runtime
  _create_client "$NAMESPACE" controller-spoof controller-spoof agent-controller
  _create_client "$NAMESPACE" not-server not-server unrelated
  _create_client "$NAMESPACE" server-spoof not-server opencrane-server
}

function _assert_profiles()
{
  kubectl exec --namespace "$NAMESPACE" controller -- curl --fail --silent --show-error --max-time 5 http://server:8081/ >/dev/null || _fail "controller cannot reach the server internal listener"
  kubectl exec --namespace "$NAMESPACE" server --container client -- curl --fail --silent --show-error --max-time 5 http://artifact."$ARTIFACT_NAMESPACE":8080/ >/dev/null || _fail "server cannot reach artifact service"
  kubectl exec --namespace "$NAMESPACE" runtime -- nslookup kubernetes.default.svc.cluster.local >/dev/null || _fail "runtime DNS is denied"
  kubectl exec --namespace "$ARTIFACT_NAMESPACE" artifact --container dns -- nslookup kubernetes.default.svc.cluster.local >/dev/null || _fail "artifact DNS is denied"

  if kubectl exec --namespace "$NAMESPACE" controller -- curl --fail --silent --show-error --max-time 5 http://server:8080/ >/dev/null; then _fail "controller reached the server public listener"; fi
  if kubectl exec --namespace "$NAMESPACE" runtime -- curl --fail --silent --show-error --max-time 5 http://server:8081/ >/dev/null; then _fail "runtime reached the server internal listener"; fi
  if kubectl exec --namespace "$NAMESPACE" controller-spoof -- curl --fail --silent --show-error --max-time 5 http://server:8081/ >/dev/null; then _fail "spoofed controller ServiceAccount reached the internal listener"; fi
  if kubectl exec --namespace "$NAMESPACE" not-server -- curl --fail --silent --show-error --max-time 5 http://artifact."$ARTIFACT_NAMESPACE":8080/ >/dev/null; then _fail "non-server workload reached artifact service"; fi
  if kubectl exec --namespace "$NAMESPACE" server-spoof -- curl --fail --silent --show-error --max-time 5 http://artifact."$ARTIFACT_NAMESPACE":8080/ >/dev/null; then _fail "server-labelled workload with the wrong ServiceAccount reached artifact service"; fi
}

function _main()
{
  _require_cmd docker
  _require_cmd helm
  _require_cmd k3d
  _require_cmd kubectl
  docker info >/dev/null 2>&1 || _fail "Docker daemon is not reachable"
  PREVIOUS_CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
  trap _cleanup EXIT

  k3d cluster create "$CLUSTER_NAME" --agents 1 --k3s-arg "--flannel-backend=none@server:0" --k3s-arg "--disable-network-policy@server:0"
  CLUSTER_CREATED=1
  kubectl config use-context "k3d-$CLUSTER_NAME" >/dev/null
  "$ROOT_DIR/apps/_infra/cilium/deploy.sh"
  _create_service_accounts
  _render_and_apply_policies
  _create_fixture_workloads
  _wait_ready "$NAMESPACE" server
  _wait_ready "$NAMESPACE" controller
  _wait_ready "$NAMESPACE" runtime
  _wait_ready "$NAMESPACE" controller-spoof
  _wait_ready "$NAMESPACE" not-server
  _wait_ready "$NAMESPACE" server-spoof
  _wait_ready "$ARTIFACT_NAMESPACE" artifact
  _assert_profiles
  echo "[cilium-runtime-profiles] profile allow/deny enforcement passed"
}

_main
