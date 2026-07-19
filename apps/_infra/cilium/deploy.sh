#!/usr/bin/env bash
set -euo pipefail

CHART="oci://quay.io/cilium/charts/cilium"
VERSION="1.19.6"
NAMESPACE="kube-system"
RELEASE="cilium"
VALUES_FILE="${CILIUM_VALUES_FILE:-}"

function _fail()
{
  echo "[cilium] $1" >&2
  exit 1
}

command -v helm >/dev/null 2>&1 || _fail "helm is required"
command -v kubectl >/dev/null 2>&1 || _fail "kubectl is required"
kubectl cluster-info >/dev/null 2>&1 || _fail "kubectl cannot reach the target cluster"

arguments=(upgrade --install "$RELEASE" "$CHART" --namespace "$NAMESPACE" --create-namespace --version "$VERSION" --wait --atomic)
if [[ -n "$VALUES_FILE" ]]
then
  [[ -f "$VALUES_FILE" ]] || _fail "CILIUM_VALUES_FILE '$VALUES_FILE' does not exist"
  arguments+=(--values "$VALUES_FILE")
fi

helm "${arguments[@]}"
kubectl rollout status daemonset/cilium --namespace "$NAMESPACE" --timeout="${CILIUM_TIMEOUT_SECONDS:-300}s"
kubectl rollout status deployment/cilium-operator --namespace "$NAMESPACE" --timeout="${CILIUM_TIMEOUT_SECONDS:-300}s"
kubectl get crd ciliumnetworkpolicies.cilium.io >/dev/null
