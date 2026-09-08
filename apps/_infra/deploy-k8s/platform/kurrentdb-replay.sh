#!/usr/bin/env bash
# Runs the installed KurrentDB replay script with the bootstrap Job's operator credentials.
KURRENTDB_REPLAY_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../kurrentdb/helm/files" && pwd)/replay.sh"

_write_kurrentdb_replay_configuration()
{
  local manifest="$1" name="${RELEASE}-kurrentdb-bootstrap"
  if ! helm get manifest "$RELEASE" -n "$NAMESPACE" \
    | awk -v name="$name" 'BEGIN { RS="---" } /\nkind: ConfigMap\n/ && index($0, "\n  name: " name "\n") { print "---"; print }' \
    | kubectl annotate --local -f - "meta.helm.sh/release-name=$RELEASE" "meta.helm.sh/release-namespace=$NAMESPACE" --overwrite -o json \
    | jq -es --arg namespace "$NAMESPACE" '
        if length != 1 then error("Expected exactly one bootstrap ConfigMap") else .[0] end
        | if (.metadata.namespace // $namespace) != $namespace then error("Unexpected namespace") else . end
        | .metadata.namespace = $namespace
      ' >"$manifest"; then
    err "Unable to read the installed KurrentDB replay configuration."
    return 1
  fi
  if ! _kurrentdb_owned_replay_configuration <"$manifest"; then
    err "Install the reviewed KurrentDB replay configuration before requesting replay."
    return 1
  fi
}

_kurrentdb_owned_replay_configuration()
{
  jq -e --arg release "$RELEASE" --arg namespace "$NAMESPACE" --arg silo "$CLUSTER_TENANT" \
    --rawfile script "$KURRENTDB_REPLAY_SOURCE" '
    .apiVersion == "v1" and .kind == "ConfigMap"
    and .metadata.name == ($release + "-kurrentdb-bootstrap") and .metadata.namespace == $namespace
    and .metadata.annotations["meta.helm.sh/release-name"] == $release
    and .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace
    and .metadata.labels["app.kubernetes.io/managed-by"] == "Helm"
    and .metadata.labels["app.kubernetes.io/component"] == "kurrentdb-bootstrap"
    and .metadata.deletionTimestamp == null
    and (.data["replay.sh"] | rtrimstr("\n")) == ($script | rtrimstr("\n"))
    and (.data["replay-target.json"] | fromjson |
      (keys | sort) == ["endpoint", "streamName"]
      and .streamName == ("computer-activations-" + $silo)
      and (.endpoint | ltrimstr("https://" + $release + "-kurrentdb." + $namespace + ".svc:")
        | test("^[1-9][0-9]{0,4}$") and tonumber <= 65535))
  ' >/dev/null
}

_write_kurrentdb_replay_job()
{
  local bootstrap="$1" configuration="$2" output="$3"
  jq -e --arg namespace "$NAMESPACE" --argjson timeout "$TIMEOUT" --slurpfile config "$configuration" '
    if (.spec.template.spec.containers | length) != 1
      or .spec.template.spec.containers[0].name != "bootstrap"
      or (.spec.template.spec.containers[0].image | test("@sha256:[a-f0-9]{64}$") | not)
      or .spec.template.spec.automountServiceAccountToken != false
      or ([.spec.template.spec.volumes[] | select(.name == "bootstrap-script") | .configMap.name] != [$config[0].metadata.name])
    then error("Unexpected bootstrap Pod contract") else . end
    | del(.status, .spec.selector, .spec.manualSelector)
    | .metadata = {generateName:"kurrentdb-activation-replay-",namespace:$namespace,labels:.metadata.labels}
    | .metadata.labels["opencrane.ai/kurrentdb-maintenance"] = "replay"
    | .spec.backoffLimit = 0 | .spec.ttlSecondsAfterFinished = 3600 | .spec.activeDeadlineSeconds = $timeout
    | .spec.template.metadata = {labels:(.spec.template.metadata.labels | del(."batch.kubernetes.io/controller-uid", ."batch.kubernetes.io/job-name", ."controller-uid", ."job-name"))}
    | .spec.template.spec.containers[0].command = ["/bin/sh", "-c", $config[0].data["replay.sh"]]
    | .spec.template.spec.containers[0].env = [{name:"OPENCRANE_KURRENTDB_REPLAY_TARGET",value:$config[0].data["replay-target.json"]}]
    | del(.spec.template.spec.containers[0].args, .spec.template.spec.containers[0].envFrom)
    | .spec.template.spec.containers[0].volumeMounts |= map(select(.name != "kurrentdb-service" and .name != "bootstrap-script"))
    | .spec.template.spec.volumes |= map(select(.name != "kurrentdb-service" and .name != "bootstrap-script")
        | if .name == "kurrentdb-tls" then .secret.items = [{key:"ca.crt",path:"ca.crt"}] else . end)
  ' "$bootstrap" >"$output"
}

# Return when replay finishes or fails, without spending the remaining timeout on a terminal Job.
_wait_for_kurrentdb_replay_job()
{
  local job_name="$1" deadline=$((SECONDS + TIMEOUT)) remaining request_timeout resource outcome
  while (( SECONDS < deadline )); do
    remaining=$((deadline - SECONDS))
    if (( remaining <= 0 )); then break; fi
    request_timeout="$remaining"
    if (( request_timeout > 30 )); then request_timeout=30; fi
    resource="$(kubectl get "job/$job_name" -n "$NAMESPACE" -o json --request-timeout="${request_timeout}s")" || return $?
    outcome="$(jq -er '
      if .apiVersion != "batch/v1" or .kind != "Job" then error("Expected a batch/v1 Job") else . end
      | [.status.conditions[]? | select(.status == "True") | .type]
      | if index("Failed") != null or index("FailureTarget") != null then "failed"
        elif index("Complete") != null then "complete" else "running" end
    ' <<<"$resource")" || return $?
    if [[ "$outcome" == complete ]]; then return 0; fi
    if [[ "$outcome" == failed ]]; then return 1; fi
    remaining=$((deadline - SECONDS))
    if (( remaining <= 0 )); then break; fi
    if (( remaining > 2 )); then remaining=2; fi
    sleep "$remaining"
  done
  return 1
}

# Freeze the verified script and target in the one-off Job, so later ConfigMap changes cannot retarget it.
# KurrentDB 26.1.1 permits replay only to OperationsOrAdmins; the application service identity stays unprivileged.
run_kurrentdb_replay_parked()
(
  local directory current configuration job_name
  _require_ready_kurrentdb_for_bootstrap || return $?
  directory="$(mktemp -d)" || return $?
  trap 'rm -rf "$directory"' EXIT
  configuration="$directory/configuration.json"
  _write_kurrentdb_replay_configuration "$configuration" || return $?
  current="$(kubectl get "configmap/${RELEASE}-kurrentdb-bootstrap" -n "$NAMESPACE" -o json --request-timeout=30s)" || return $?
  if ! _kurrentdb_owned_replay_configuration <<<"$current" \
    || ! jq -e --slurpfile installed "$configuration" '.data["replay.sh"] == $installed[0].data["replay.sh"] and .data["replay-target.json"] == $installed[0].data["replay-target.json"]' >/dev/null <<<"$current"; then
    err "The live KurrentDB replay configuration differs from the installed release."
    return 1
  fi
  _write_kurrentdb_bootstrap_manifest "$directory/bootstrap.json" || return $?
  _write_kurrentdb_replay_job "$directory/bootstrap.json" "$configuration" "$directory/replay.json" || return $?
  job_name="$(kubectl create -f "$directory/replay.json" -n "$NAMESPACE" -o jsonpath='{.metadata.name}' --request-timeout=30s)" || return $?
  [[ "$job_name" =~ ^kurrentdb-activation-replay-[a-z0-9]+$ ]] || { err "KurrentDB replay returned an unexpected Job name."; return 1; }
  log "Waiting for KurrentDB replay Job '$job_name'…"
  if ! _wait_for_kurrentdb_replay_job "$job_name"; then
    err "KurrentDB replay Job '$job_name' did not complete; its bounded Job remains available for diagnosis."
    return 1
  fi
  kubectl logs "job/$job_name" -n "$NAMESPACE" --container=bootstrap --request-timeout=30s || return $?
)
