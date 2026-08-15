#!/usr/bin/env bash
# Classifies whether this Helm release must render the shared ClusterTenant CRD.
# A foreign owner is consumable only when its authority-bearing spec is exactly
# the current chart contract; Kubernetes metadata and status are irrelevant.

_cluster_tenant_crd_spec()
{
  # Compare the full behavioral contract. Only normalize API-server defaults
  # which may be absent from a client-side Helm render but present on the live
  # object. In particular, never discard conversion webhook configuration: it
  # is an authority boundary because it can receive and transform every object.
  jq -cS '.spec
    | .conversion = (.conversion // {"strategy":"None"})
    | .preserveUnknownFields = (.preserveUnknownFields // false)'
}

resolve_cluster_tenant_crd_install()
{
  local chart_dir="$1"
  local release="$2"
  local namespace="$3"
  shift 3

  local live_crd
  local owner_release
  local owner_namespace
  local expected_crd
  local expected_spec
  local live_spec

  live_crd="$(kubectl get crd clustertenants.opencrane.io --ignore-not-found -o json)" || {
    echo "[cluster-tenant-crd] Cannot read the shared ClusterTenant CRD." >&2
    return 1
  }
  if [[ -z "$live_crd" ]]; then
    printf 'true\n'
    return
  fi

  owner_release="$(jq -r '.metadata.annotations["meta.helm.sh/release-name"] // empty' <<<"$live_crd")"
  owner_namespace="$(jq -r '.metadata.annotations["meta.helm.sh/release-namespace"] // empty' <<<"$live_crd")"
  if [[ "$owner_release" == "$release" && "$owner_namespace" == "$namespace" ]]; then
    printf 'true\n'
    return
  fi

  # The render is local and has no Helm ownership identity. A fixed short name
  # keeps every valid 53-character live release eligible for this comparison.
  expected_crd="$(helm template opencrane-crd-contract "$chart_dir" \
    --set crds.install=true "$@" \
    --show-only templates/crds/opencrane.io_clustertenants.yaml \
    | kubectl create --dry-run=client --validate=false -f - -o json)" || {
      echo "[cluster-tenant-crd] Cannot render the expected ClusterTenant CRD contract." >&2
      return 1
    }
  expected_spec="$(printf '%s' "$expected_crd" | _cluster_tenant_crd_spec)" || return 1
  live_spec="$(printf '%s' "$live_crd" | _cluster_tenant_crd_spec)" || return 1
  if [[ "$live_spec" != "$expected_spec" ]]; then
    echo "[cluster-tenant-crd] Existing foreign-owned ClusterTenant CRD is incompatible with this release." >&2
    return 1
  fi

  printf 'false\n'
}
