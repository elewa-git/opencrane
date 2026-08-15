#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/cluster-tenant-crd-policy.sh"
source "$POLICY"

expected_spec='{"group":"opencrane.io","names":{"kind":"ClusterTenant","plural":"clustertenants"},"scope":"Cluster","versions":[{"name":"v1alpha1","schema":{"openAPIV3Schema":{"type":"object"}},"served":true,"storage":true,"subresources":{"status":{}}}]}'
mock_expected_crd="$(jq -cn --argjson spec "$expected_spec" '{metadata:{name:"clustertenants.opencrane.io"},spec:$spec}')"
mock_live_crd=""
kubectl_get_status=0

helm()
{
  [[ "$1" == "template" && "$2" == "opencrane-crd-contract" ]] || return 1
  printf '%s\n' 'apiVersion: apiextensions.k8s.io/v1'
}

kubectl()
{
  if [[ "$1" == "get" ]]; then
    (( kubectl_get_status == 0 )) || return "$kubectl_get_status"
    printf '%s' "$mock_live_crd"
    return
  fi
  if [[ "$1" == "create" ]]; then
    cat >/dev/null
    printf '%s' "$mock_expected_crd"
    return
  fi
  return 1
}

result="$(resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4)"
[[ "$result" == "true" ]]

mock_live_crd="$(jq -cn --argjson spec "$expected_spec" '{metadata:{annotations:{"meta.helm.sh/release-name":"opencrane-testv4","meta.helm.sh/release-namespace":"opencrane-testv4"}},spec:$spec}')"
result="$(resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4)"
[[ "$result" == "true" ]]

mock_live_crd="$(jq -cn --argjson spec "$expected_spec" '{metadata:{},spec:($spec | .conversion={strategy:"None"} | .preserveUnknownFields=false)}')"
result="$(resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4)"
[[ "$result" == "false" ]]

long_release="$(printf 'r%.0s' {1..53})"
result="$(resolve_cluster_tenant_crd_install chart "$long_release" opencrane-testv4)"
[[ "$result" == "false" ]]

mock_live_crd="$(jq -cn --argjson spec "$expected_spec" '{metadata:{},spec:($spec | .conversion={strategy:"Webhook",webhook:{clientConfig:{url:"https://foreign.example.invalid/convert"},conversionReviewVersions:["v1"]}})}')"
if resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4 >/dev/null 2>&1; then
  echo "foreign ClusterTenant conversion webhook was accepted" >&2
  exit 1
fi

mock_live_crd="$(jq -cn --argjson spec "$expected_spec" '{metadata:{},spec:($spec | .versions[0].schema.openAPIV3Schema.type="string")}')"
if resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4 >/dev/null 2>&1; then
  echo "incompatible shared ClusterTenant CRD was accepted" >&2
  exit 1
fi

kubectl_get_status=1
if resolve_cluster_tenant_crd_install chart opencrane-testv4 opencrane-testv4 >/dev/null 2>&1; then
  echo "unreadable shared ClusterTenant CRD was accepted" >&2
  exit 1
fi

echo "cluster-tenant CRD policy contract: PASS"
