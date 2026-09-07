#!/usr/bin/env bash

# k8s-deploy.sh calls this helper only for the explicit snapshot prerequisite action. The helper
# never installs a driver or patches a class: a retry must find the exact owned retention policy.
_gke_snapshot_class_matches()
{
  local name="$1"
  jq -e --arg name "$name" '
    .apiVersion == "snapshot.storage.k8s.io/v1" and .kind == "VolumeSnapshotClass"
    and .metadata.name == $name
    and .metadata.deletionTimestamp == null
    and .metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-prerequisite-bootstrap"
    and .metadata.labels["opencrane.ai/prerequisite"] == "gke-pd-snapshot-class"
    and ((.metadata.annotations // {}) | has("snapshot.storage.kubernetes.io/is-default-class") | not)
    and .driver == "pd.csi.storage.gke.io"
    and .deletionPolicy == "Delete"
    and ((.parameters // {}) == {})
  ' >/dev/null
}

_gke_snapshot_class_error()
{
  printf '[gke-snapshot-class] %s\n' "$*" >&2
  return 1
}

provision_gke_snapshot_class()
{
  local name="${1:-}" context="" storage_class="" current_context api driver storage existing created value executable
  if [[ "$name" == "--help" || "$name" == "-h" ]]; then
    printf 'Usage: k8s-deploy.sh --provision-gke-snapshot-class NAME --context CONTEXT --storage-class SC\n'
    return 0
  fi
  [[ -n "$name" ]] || { _gke_snapshot_class_error 'A snapshot class name is required.'; return 1; }
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --context|--storage-class)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { _gke_snapshot_class_error "$1 requires a value."; return 1; }
        if [[ "$1" == "--context" ]]; then context="$2"; else storage_class="$2"; fi
        shift 2
        ;;
      *) _gke_snapshot_class_error "Unsupported prerequisite argument: $1"; return 1 ;;
    esac
  done
  [[ -n "$context" && -n "$storage_class" ]] || { _gke_snapshot_class_error '--context and --storage-class are required.'; return 1; }
  for value in "$name" "$storage_class"; do
    if (( ${#value} > 63 )) || [[ ! "$value" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
      _gke_snapshot_class_error 'Snapshot and storage class names must be DNS labels of at most 63 characters.'
      return 1
    fi
  done
  for executable in kubectl jq; do
    command -v "$executable" >/dev/null 2>&1 || { _gke_snapshot_class_error "$executable is required."; return 1; }
  done
  current_context="$(kubectl config current-context)" || return 1
  [[ "$current_context" == "$context" ]] || { _gke_snapshot_class_error 'Current kubectl context does not match --context.'; return 1; }
  local kube=(kubectl --context "$context" --request-timeout=30s)
  api="$("${kube[@]}" get --raw /apis/snapshot.storage.k8s.io/v1)" || return 1
  if ! jq -e '
    .groupVersion == "snapshot.storage.k8s.io/v1"
    and any(.resources[]; .name == "volumesnapshotclasses" and .namespaced == false)
    and any(.resources[]; .name == "volumesnapshotcontents" and .namespaced == false)
    and any(.resources[]; .name == "volumesnapshots" and .namespaced == true)
  ' >/dev/null <<<"$api"; then
    _gke_snapshot_class_error 'The complete v1 snapshot API is required.'
    return 1
  fi
  driver="$("${kube[@]}" get csidriver.storage.k8s.io pd.csi.storage.gke.io -o json)" || return 1
  jq -e '.metadata.name == "pd.csi.storage.gke.io"' >/dev/null <<<"$driver" || return 1
  storage="$("${kube[@]}" get storageclass "$storage_class" -o json)" || return 1
  if ! jq -e --arg name "$storage_class" '.metadata.name == $name and .provisioner == "pd.csi.storage.gke.io"' >/dev/null <<<"$storage"; then
    _gke_snapshot_class_error 'The selected StorageClass must use pd.csi.storage.gke.io.'
    return 1
  fi
  existing="$("${kube[@]}" get volumesnapshotclass "$name" --ignore-not-found -o json)" || return 1
  if [[ -n "$existing" ]]; then
    if ! _gke_snapshot_class_matches "$name" <<<"$existing"; then
      _gke_snapshot_class_error "Existing class '$name' conflicts with the owned non-default GKE PD class; refusing to adopt or alter it."
      return 1
    fi
    printf '[gke-snapshot-class] Verified existing class %s.\n' "$name"
    return 0
  fi

  # Create fails if another writer wins the name. Only a later explicit retry may validate that class.
  created="$(jq -n --arg name "$name" '{
    apiVersion: "snapshot.storage.k8s.io/v1", kind: "VolumeSnapshotClass",
    metadata: {name: $name, labels: {
      "app.kubernetes.io/managed-by": "opencrane-prerequisite-bootstrap",
      "opencrane.ai/prerequisite": "gke-pd-snapshot-class"
    }}, driver: "pd.csi.storage.gke.io", deletionPolicy: "Delete"
  }' | "${kube[@]}" create -f - -o json)" || return 1
  if ! _gke_snapshot_class_matches "$name" <<<"$created"; then
    _gke_snapshot_class_error 'The API returned an unexpected class after creation; inspect the resource before retrying.'
    return 1
  fi
  printf '[gke-snapshot-class] Created non-default class %s with driver pd.csi.storage.gke.io and Delete policy.\n' "$name"
}
