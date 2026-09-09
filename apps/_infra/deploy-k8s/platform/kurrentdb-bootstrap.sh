#!/usr/bin/env bash

# The deploy entrypoint and restore helper recreate only the release-owned bootstrap Job.
# Bootstrap verifies the existing credentials and stream policy; it does not restore ledger data.
_kurrentdb_owned_bootstrap_job()
{
  jq -e --arg name "${RELEASE}-kurrentdb-bootstrap" --arg release "$RELEASE" --arg namespace "$NAMESPACE" '
    .apiVersion == "batch/v1" and .kind == "Job"
    and .metadata.name == $name and .metadata.namespace == $namespace
    and .metadata.annotations["meta.helm.sh/release-name"] == $release
    and .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace
    and .spec.template.metadata.labels["app.kubernetes.io/instance"] == $release
    and .metadata.labels["app.kubernetes.io/component"] == "kurrentdb-bootstrap"
    and .metadata.deletionTimestamp == null
  ' >/dev/null
}

_write_kurrentdb_bootstrap_manifest()
{
  local manifest="$1" job_name="${RELEASE}-kurrentdb-bootstrap"
  if ! helm get manifest "$RELEASE" -n "$NAMESPACE" \
    | awk -v name="$job_name" 'BEGIN { RS="---" } /\nkind: Job\n/ && index($0, "\n  name: " name "\n") { print "---"; print }' \
    | kubectl annotate --local -f - "meta.helm.sh/release-name=$RELEASE" "meta.helm.sh/release-namespace=$NAMESPACE" --overwrite -o json \
    | jq -es --arg namespace "$NAMESPACE" '
        if length != 1 then error("Expected exactly one bootstrap Job") else .[0] end
        | if (.metadata.namespace // $namespace) != $namespace then error("Unexpected Job namespace") else . end
        | .metadata.namespace = $namespace
      ' >"$manifest"; then
    err "Unable to read the release-owned KurrentDB bootstrap manifest."
    return 1
  fi
  if ! _kurrentdb_owned_bootstrap_job <"$manifest"; then
    err "The release manifest does not contain the expected KurrentDB bootstrap Job."
    return 1
  fi
}

_rerun_kurrentdb_bootstrap()
{
  local job_name="${RELEASE}-kurrentdb-bootstrap" current_job manifest retry_only="${1:-0}"
  current_job="$(kubectl get "job/$job_name" -n "$NAMESPACE" --ignore-not-found -o json --request-timeout=30s)" || return $?
  if [[ -n "$current_job" ]] && ! _kurrentdb_owned_bootstrap_job <<<"$current_job"; then
    err "Refusing to replace a foreign or deleting KurrentDB bootstrap Job."
    return 1
  fi
  if [[ "$retry_only" == 1 && -n "$current_job" ]] && ! jq -e '(.status.active // 0) == 0 and any(.status.conditions[]?; (.type == "Failed" or .type == "FailureTarget") and .status == "True")' >/dev/null <<<"$current_job"; then
    err "KurrentDB bootstrap retry requires a failed or missing Job."
    return 1
  fi
  manifest="$(mktemp)" || return $?
  _write_kurrentdb_bootstrap_manifest "$manifest" || { rm -f "$manifest"; return 1; }
  # Job pod templates are immutable. Recreate the same reviewed manifest with Helm ownership.
  kubectl delete -f "$manifest" -n "$NAMESPACE" --ignore-not-found --wait=true --timeout="${TIMEOUT}s" >/dev/null || { rm -f "$manifest"; return 1; }
  kubectl create -f "$manifest" -n "$NAMESPACE" >/dev/null || { rm -f "$manifest"; return 1; }
  rm -f "$manifest"
  wait_for_final_kurrentdb_bootstrap_job_if_present || return $?
}

_require_ready_kurrentdb_for_bootstrap()
{
  local statefulset
  statefulset="$(kubectl get "statefulset/${RELEASE}-kurrentdb" -n "$NAMESPACE" -o json --request-timeout=30s)" || return $?
  if ! jq -e --arg release "$RELEASE" --arg namespace "$NAMESPACE" '
    .apiVersion == "apps/v1" and .kind == "StatefulSet" and .metadata.name == ($release + "-kurrentdb")
    and .metadata.namespace == $namespace
    and .metadata.annotations["meta.helm.sh/release-name"] == $release
    and .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace
    and .metadata.labels["app.kubernetes.io/component"] == "kurrentdb"
    and .spec.template.metadata.labels["app.kubernetes.io/instance"] == $release
    and .metadata.deletionTimestamp == null and (.status.readyReplicas // 0) > 0
  ' >/dev/null <<<"$statefulset"; then
    err "KurrentDB must be Ready before changing bootstrap verification."
    return 1
  fi
}

run_kurrentdb_bootstrap_retry()
{
  local current_job
  current_job="$(kubectl get "job/${RELEASE}-kurrentdb-bootstrap" -n "$NAMESPACE" --ignore-not-found -o json --request-timeout=30s)" || return $?
  if [[ -n "$current_job" ]]; then
    if ! _kurrentdb_owned_bootstrap_job <<<"$current_job"; then
      err "Refusing to retry a foreign or deleting KurrentDB bootstrap Job."
      return 1
    fi
    if ! jq -e '(.status.active // 0) == 0 and any(.status.conditions[]?; (.type == "Failed" or .type == "FailureTarget") and .status == "True")' >/dev/null <<<"$current_job"; then
      err "KurrentDB bootstrap retry requires a failed or missing Job."
      return 1
    fi
  fi
  _require_ready_kurrentdb_for_bootstrap || return $?
  log "Retrying the failed or missing KurrentDB bootstrap Job…"
  _rerun_kurrentdb_bootstrap 1 || return $?
  log "KurrentDB bootstrap verification completed."
}

# Remove completed verification metadata before a normal deploy supplies a changed Job template.
# The API checks both preconditions atomically; a replacement Job or intervening update is refused.
# See https://github.com/kubernetes/kubectl/blob/v0.36.0/pkg/cmd/delete/delete.go for raw DELETE bodies.
run_kurrentdb_bootstrap_prepare_update()
(
  local current_job work_directory job_name="${RELEASE}-kurrentdb-bootstrap"
  current_job="$(kubectl get "job/$job_name" -n "$NAMESPACE" --ignore-not-found -o json --request-timeout=30s)" || return $?
  if [[ -z "$current_job" ]]; then
    log "KurrentDB bootstrap Job is already absent; the next normal deploy can create it."
    return 0
  fi
  if ! _kurrentdb_owned_bootstrap_job <<<"$current_job"; then
    err "Refusing to prepare a foreign or deleting KurrentDB bootstrap Job."
    return 1
  fi
  if ! jq -e '
    (.status.active // 0) == 0 and (.status.terminating // 0) == 0
    and any(.status.conditions[]?; .type == "Complete" and .status == "True")
    and all(.status.conditions[]?; (.type != "Failed" and .type != "FailureTarget") or .status != "True")
  ' >/dev/null <<<"$current_job"; then
    err "KurrentDB bootstrap preparation requires a completed, inactive Job."
    return 1
  fi
  _require_ready_kurrentdb_for_bootstrap || return $?
  work_directory="$(mktemp -d)" || return $?
  trap 'rm -rf "$work_directory"' EXIT
  _write_kurrentdb_bootstrap_manifest "$work_directory/manifest.json" || return $?
  if ! jq -e '
    if (.metadata.uid | type) != "string" or (.metadata.uid | length) == 0
      or (.metadata.resourceVersion | type) != "string" or (.metadata.resourceVersion | length) == 0
    then error("Bootstrap Job lacks deletion preconditions") else . end
    | {apiVersion: "v1", kind: "DeleteOptions", propagationPolicy: "Foreground",
       preconditions: {uid: .metadata.uid, resourceVersion: .metadata.resourceVersion}}
  ' <<<"$current_job" >"$work_directory/delete-options.json"; then
    err "Unable to bind bootstrap preparation to the observed Job."
    return 1
  fi
  kubectl delete --raw "/apis/batch/v1/namespaces/$NAMESPACE/jobs/$job_name" \
    -f "$work_directory/delete-options.json" --request-timeout=30s >/dev/null || return $?
  kubectl wait --for=delete "job/$job_name" -n "$NAMESPACE" --timeout="${TIMEOUT}s" --request-timeout=30s >/dev/null || return $?
  log "Completed KurrentDB bootstrap Job removed. Run the normal deployment with the intended image and configuration."
)
