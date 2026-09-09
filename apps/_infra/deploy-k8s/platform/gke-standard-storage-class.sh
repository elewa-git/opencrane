#!/usr/bin/env bash

# k8s-deploy.sh calls this helper only for the explicit standard-disk prerequisite action.
# A retry verifies the owned class; it never changes existing claims, disks, or the cluster default.
_gke_standard_storage_class_matches()
{
  local name="$1"
  jq -e --arg name "$name" '
    .apiVersion == "storage.k8s.io/v1" and .kind == "StorageClass"
    and .metadata.name == $name
    and .metadata.deletionTimestamp == null
    and .metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-prerequisite-bootstrap"
    and .metadata.labels["opencrane.ai/prerequisite"] == "gke-pd-standard-storage-class"
    and ((.metadata.annotations // {}) | has("storageclass.kubernetes.io/is-default-class") | not)
    and ((.metadata.annotations // {}) | has("storageclass.beta.kubernetes.io/is-default-class") | not)
    and .provisioner == "pd.csi.storage.gke.io"
    and .parameters == {"type": "pd-standard"}
    and .allowVolumeExpansion == true
    and .volumeBindingMode == "WaitForFirstConsumer"
    and .reclaimPolicy == "Delete"
    and ((.mountOptions // []) == [])
    and ((.allowedTopologies // []) == [])
  ' >/dev/null
}

_gke_standard_storage_class_error()
{
  printf '[gke-standard-storage-class] %s\n' "$*" >&2
  return 1
}

provision_gke_standard_storage_class()
{
  local name="${1:-}" context="" current_context driver existing created executable
  if [[ "$name" == "--help" || "$name" == "-h" ]]; then
    printf 'Usage: k8s-deploy.sh --provision-gke-standard-storage-class NAME --context CONTEXT\n'
    return 0
  fi
  [[ -n "$name" ]] || { _gke_standard_storage_class_error 'A storage class name is required.'; return 1; }
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --context)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { _gke_standard_storage_class_error '--context requires a value.'; return 1; }
        [[ -z "$context" ]] || { _gke_standard_storage_class_error '--context must appear once.'; return 1; }
        context="$2"
        shift 2
        ;;
      *) _gke_standard_storage_class_error "Unsupported prerequisite argument: $1"; return 1 ;;
    esac
  done
  [[ -n "$context" ]] || { _gke_standard_storage_class_error '--context is required.'; return 1; }
  if (( ${#name} > 63 )) || [[ ! "$name" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
    _gke_standard_storage_class_error 'The storage class name must be a DNS label of at most 63 characters.'
    return 1
  fi
  for executable in kubectl jq; do
    command -v "$executable" >/dev/null 2>&1 || { _gke_standard_storage_class_error "$executable is required."; return 1; }
  done
  current_context="$(kubectl config current-context)" || return 1
  [[ "$current_context" == "$context" ]] || { _gke_standard_storage_class_error 'Current kubectl context does not match --context.'; return 1; }
  local kube=(kubectl --context "$context" --request-timeout=30s)
  driver="$("${kube[@]}" get csidriver.storage.k8s.io pd.csi.storage.gke.io -o json)" || return 1
  if ! jq -e '.apiVersion == "storage.k8s.io/v1" and .kind == "CSIDriver" and .metadata.name == "pd.csi.storage.gke.io" and .metadata.deletionTimestamp == null' >/dev/null <<<"$driver"; then
    _gke_standard_storage_class_error 'The installed pd.csi.storage.gke.io driver is required.'
    return 1
  fi
  existing="$("${kube[@]}" get storageclass "$name" --ignore-not-found -o json)" || return 1
  if [[ -n "$existing" ]]; then
    if ! _gke_standard_storage_class_matches "$name" <<<"$existing"; then
      _gke_standard_storage_class_error "Existing class '$name' conflicts with the owned non-default standard-disk class; refusing to adopt or alter it."
      return 1
    fi
    printf '[gke-standard-storage-class] Verified existing class %s.\n' "$name"
    return 0
  fi

  # Create fails if another writer wins the name. A later explicit retry may verify that resource.
  created="$(jq -n --arg name "$name" '{
    apiVersion: "storage.k8s.io/v1", kind: "StorageClass",
    metadata: {name: $name, labels: {
      "app.kubernetes.io/managed-by": "opencrane-prerequisite-bootstrap",
      "opencrane.ai/prerequisite": "gke-pd-standard-storage-class"
    }}, provisioner: "pd.csi.storage.gke.io", parameters: {type: "pd-standard"},
    allowVolumeExpansion: true, volumeBindingMode: "WaitForFirstConsumer", reclaimPolicy: "Delete"
  }' | "${kube[@]}" create -f - -o json)" || return 1
  if ! _gke_standard_storage_class_matches "$name" <<<"$created"; then
    _gke_standard_storage_class_error 'The API returned an unexpected class after creation; inspect the resource before retrying.'
    return 1
  fi
  printf '[gke-standard-storage-class] Created non-default class %s with pd-standard disks and Delete policy.\n' "$name"
}
