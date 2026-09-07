#!/usr/bin/env bash
# Restores the KurrentDB data volume from one scheduled backup, driven by k8s-deploy.sh.
#
# The backup CronJob rendered by apps/_infra/kurrentdb is the single source of truth: this helper
# reads its mode annotation and jobTemplate, so the restore uses the same image, scripts, volumes,
# and security context as the backups it restores. The sequence is always: refuse while the node is
# serving unless the operator confirmed, scale the StatefulSet to zero, restore, scale back up, and
# re-run the bootstrap Job so the service user, ACL, and activation subscription are re-verified.
#
# The caller supplies RELEASE, NAMESPACE, TIMEOUT, log/warn/err, wait_for_final_statefulset_if_present,
# and wait_for_final_kurrentdb_bootstrap_job_if_present.

KURRENTDB_RESTORE_SCHEDULED_SELECTOR=""

_kurrentdb_restore_names()
{
  KURRENTDB_STATEFULSET="${RELEASE}-kurrentdb"
  KURRENTDB_BACKUP_CRONJOB="${RELEASE}-kurrentdb-backup"
  KURRENTDB_DATA_CLAIM="data-${KURRENTDB_STATEFULSET}-0"
  KURRENTDB_RESTORE_SCHEDULED_SELECTOR="app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=kurrentdb-backup,opencrane.ai/kurrentdb-backup-kind=scheduled"
}

# Prints the backups the operator can name with --kurrentdb-restore.
list_kurrentdb_backups()
{
  local mode
  _kurrentdb_restore_names
  mode="$(_kurrentdb_backup_mode)" || return $?
  if [[ "$mode" == "volumeSnapshot" ]]; then
    kubectl get volumesnapshot -n "$NAMESPACE" -l "$KURRENTDB_RESTORE_SCHEDULED_SELECTOR" \
      --sort-by=.metadata.creationTimestamp \
      -o custom-columns='BACKUP:.metadata.name,READY:.status.readyToUse,CREATED:.metadata.creationTimestamp,SIZE:.status.restoreSize'
    return
  fi
  # The archive PVC is only readable from a Pod; the backup container image already has the tools.
  _kurrentdb_run_archive_job list "" || return $?
}

_kurrentdb_backup_mode()
{
  local mode
  if ! mode="$(kubectl get "cronjob/$KURRENTDB_BACKUP_CRONJOB" -n "$NAMESPACE" \
    -o 'jsonpath={.metadata.annotations.opencrane\.ai/kurrentdb-backup-mode}' 2>/dev/null)" || [[ -z "$mode" ]]; then
    err "KurrentDB backup CronJob '$KURRENTDB_BACKUP_CRONJOB' is not installed in '$NAMESPACE'; enable historyStore.kurrentdb.backup first."
    return 1
  fi
  printf '%s' "$mode"
}

# Turns the CronJob's jobTemplate into one restore (or list) Job. jq keeps every field the chart set
# (image digest, security context, volumes) and changes only what the restore needs: no node
# affinity (the database Pod is gone), a writable data mount, and the restore command.
_kurrentdb_render_archive_job()
{
  local action="$1"
  local backup_id="$2"
  local job_name="$3"
  local script="restore.sh"
  [[ "$action" == "list" ]] && script="list.sh"
  kubectl get "cronjob/$KURRENTDB_BACKUP_CRONJOB" -n "$NAMESPACE" -o json \
    | jq --arg name "$job_name" --arg namespace "$NAMESPACE" --arg id "$backup_id" --arg script "$script" --arg action "$action" '
        .spec.jobTemplate
        | .apiVersion = "batch/v1"
        | .kind = "Job"
        | .metadata = ((.metadata // {}) + {name: $name, namespace: $namespace})
        | .metadata.labels = ((.metadata.labels // {}) + {"opencrane.ai/kurrentdb-restore": $action})
        | .spec.backoffLimit = 0
        | .spec.ttlSecondsAfterFinished = 86400
        | del(.spec.template.spec.affinity)
        | .spec.template.spec.containers[0].command = ["/bin/sh", "-c",
            (if $action == "list" then
              "for d in /var/lib/opencrane/kurrentdb-backups/*/; do [ -f \"$d/manifest.json\" ] && cat \"$d/manifest.json\"; done; true"
            else
              "exec /bin/sh /opt/opencrane/kurrentdb-backup/" + $script
            end)]
        | .spec.template.spec.containers[0].env = ((.spec.template.spec.containers[0].env // []) + [{name: "OPENCRANE_RESTORE_BACKUP_ID", value: $id}])
        | (if $action == "list" then
            # Listing reads only the archive; the running database keeps its ReadWriteOnce volume.
            .spec.template.spec.containers[0].volumeMounts |= map(select(.name != "data"))
            | .spec.template.spec.volumes |= map(select(.name != "data"))
          else
            .spec.template.spec.containers[0].volumeMounts |= map(if .name == "data" then .readOnly = false else . end)
          end)
      '
}

_kurrentdb_run_archive_job()
{
  local action="$1"
  local backup_id="$2"
  local job_name="${RELEASE}-kurrentdb-${action}-$(date -u +%Y%m%d%H%M%S)"
  local deadline
  deadline="$(kubectl get "cronjob/$KURRENTDB_BACKUP_CRONJOB" -n "$NAMESPACE" -o 'jsonpath={.spec.jobTemplate.spec.activeDeadlineSeconds}')"
  deadline="${deadline:-$TIMEOUT}"
  _kurrentdb_render_archive_job "$action" "$backup_id" "$job_name" | kubectl create -f - >/dev/null || return $?
  if ! kubectl wait --for=condition=complete "job/$job_name" -n "$NAMESPACE" --timeout="${deadline}s"; then
    err "KurrentDB $action Job '$job_name' did not complete."
    kubectl describe "job/$job_name" -n "$NAMESPACE" >&2 || true
    kubectl logs "job/$job_name" -n "$NAMESPACE" --all-containers=true >&2 || true
    return 1
  fi
  kubectl logs "job/$job_name" -n "$NAMESPACE" --all-containers=true
}

_kurrentdb_wait_for_volume_snapshot()
{
  local name="$1"
  if ! kubectl wait --for='jsonpath={.status.readyToUse}=true' "volumesnapshot/$name" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
    err "VolumeSnapshot '$name' did not become ready to use."
    return 1
  fi
}

_kurrentdb_restore_from_volume_snapshot()
{
  local backup_id="$1"
  local ready storage_class storage_size safety_name snapshot_class
  if [[ "$backup_id" == "latest" ]]; then
    backup_id="$(kubectl get volumesnapshot -n "$NAMESPACE" -l "$KURRENTDB_RESTORE_SCHEDULED_SELECTOR" \
      --sort-by=.metadata.creationTimestamp -o 'jsonpath={range .items[?(@.status.readyToUse==true)]}{.metadata.name}{"\n"}{end}' | tail -n 1)"
    [[ -n "$backup_id" ]] || { err "No ready KurrentDB VolumeSnapshot exists for release '$RELEASE'."; return 1; }
  fi
  ready="$(kubectl get "volumesnapshot/$backup_id" -n "$NAMESPACE" -o 'jsonpath={.status.readyToUse}')" || return $?
  [[ "$ready" == "true" ]] || { err "VolumeSnapshot '$backup_id' is not ready to use."; return 1; }
  snapshot_class="$(kubectl get "volumesnapshot/$backup_id" -n "$NAMESPACE" -o 'jsonpath={.spec.volumeSnapshotClassName}')"
  storage_class="$(kubectl get "pvc/$KURRENTDB_DATA_CLAIM" -n "$NAMESPACE" -o 'jsonpath={.spec.storageClassName}')" || return $?
  storage_size="$(kubectl get "pvc/$KURRENTDB_DATA_CLAIM" -n "$NAMESPACE" -o 'jsonpath={.spec.resources.requests.storage}')" || return $?
  [[ -n "$storage_size" ]] || { err "Cannot read the current KurrentDB data claim size."; return 1; }

  # The node is stopped, so this safety snapshot is fully consistent. It is kept until an operator
  # deletes it; the scheduled pruning never touches it.
  safety_name="${KURRENTDB_STATEFULSET}-prerestore-$(date -u +%Y%m%dt%H%M%Sz)"
  log "Taking pre-restore safety snapshot '$safety_name' of '$KURRENTDB_DATA_CLAIM'…"
  kubectl create -f - <<EOF >/dev/null
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: $safety_name
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/instance: $RELEASE
    app.kubernetes.io/component: kurrentdb-backup
    opencrane.ai/kurrentdb-backup-kind: pre-restore
spec:
  volumeSnapshotClassName: $snapshot_class
  source:
    persistentVolumeClaimName: $KURRENTDB_DATA_CLAIM
EOF
  _kurrentdb_wait_for_volume_snapshot "$safety_name" || return $?

  log "Replacing '$KURRENTDB_DATA_CLAIM' with a volume restored from '$backup_id'…"
  kubectl delete "pvc/$KURRENTDB_DATA_CLAIM" -n "$NAMESPACE" --wait=true --timeout="${TIMEOUT}s" || return $?
  kubectl create -f - <<EOF >/dev/null
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $KURRENTDB_DATA_CLAIM
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/instance: $RELEASE
    app.kubernetes.io/component: kurrentdb
    opencrane.ai/kurrentdb-restored-from: $backup_id
spec:
  accessModes: ["ReadWriteOnce"]
${storage_class:+  storageClassName: $storage_class}
  resources:
    requests:
      storage: $storage_size
  dataSource:
    apiGroup: snapshot.storage.k8s.io
    kind: VolumeSnapshot
    name: $backup_id
EOF
  log "Safety snapshot '$safety_name' holds the pre-restore volume; delete it once the restore is verified."
}

# Entry point for `k8s-deploy.sh --kurrentdb-restore BACKUP_ID [--kurrentdb-restore-confirm-serving]`.
run_kurrentdb_restore()
{
  local backup_id="$1"
  local confirm_serving="$2"
  local mode ready_replicas desired_replicas
  _kurrentdb_restore_names
  mode="$(_kurrentdb_backup_mode)" || return $?
  if ! kubectl get "statefulset/$KURRENTDB_STATEFULSET" -n "$NAMESPACE" >/dev/null 2>&1; then
    err "KurrentDB StatefulSet '$KURRENTDB_STATEFULSET' does not exist in '$NAMESPACE'."
    return 1
  fi
  ready_replicas="$(kubectl get "statefulset/$KURRENTDB_STATEFULSET" -n "$NAMESPACE" -o 'jsonpath={.status.readyReplicas}')"
  desired_replicas="$(kubectl get "statefulset/$KURRENTDB_STATEFULSET" -n "$NAMESPACE" -o 'jsonpath={.spec.replicas}')"
  desired_replicas="${desired_replicas:-1}"
  if [[ "${ready_replicas:-0}" -gt 0 && "$confirm_serving" != "1" ]]; then
    err "KurrentDB '$KURRENTDB_STATEFULSET' is serving traffic (${ready_replicas} ready). A restore discards every conversation entry written after backup '$backup_id'. Re-run with --kurrentdb-restore-confirm-serving to proceed anyway."
    return 1
  fi

  log "Restoring KurrentDB '$KURRENTDB_STATEFULSET' from $mode backup '$backup_id'…"
  kubectl scale "statefulset/$KURRENTDB_STATEFULSET" -n "$NAMESPACE" --replicas=0 >/dev/null || return $?
  kubectl wait --for=delete "pod/${KURRENTDB_STATEFULSET}-0" -n "$NAMESPACE" --timeout="${TIMEOUT}s" || return $?

  if [[ "$mode" == "volumeSnapshot" ]]; then
    _kurrentdb_restore_from_volume_snapshot "$backup_id" || return $?
  else
    _kurrentdb_run_archive_job restore "$backup_id" || return $?
  fi

  kubectl scale "statefulset/$KURRENTDB_STATEFULSET" -n "$NAMESPACE" --replicas="$desired_replicas" >/dev/null || return $?
  wait_for_final_statefulset_if_present "$KURRENTDB_STATEFULSET" || return $?

  # The bootstrap Job is idempotent: it verifies the service user, the exact ACL, and the activation
  # subscription against the restored ledger and fails loudly when the restored state disagrees.
  log "Re-running the KurrentDB bootstrap verification Job…"
  local bootstrap_manifest
  bootstrap_manifest="$(mktemp)"
  # A Job's pod template is immutable, so the release's own manifest is deleted and re-created. The
  # Helm ownership annotations are restored so the next upgrade still recognises the Job as its own.
  helm get manifest "$RELEASE" -n "$NAMESPACE" \
    | awk 'BEGIN { RS="---" } /kind: Job/ && /name: '"${RELEASE}"'-kurrentdb-bootstrap/ { print "---"; print }' \
    | kubectl annotate --local -f - "meta.helm.sh/release-name=$RELEASE" "meta.helm.sh/release-namespace=$NAMESPACE" --overwrite -o yaml \
    >"$bootstrap_manifest" || { rm -f "$bootstrap_manifest"; return 1; }
  kubectl delete -f "$bootstrap_manifest" -n "$NAMESPACE" --ignore-not-found --wait=true --timeout="${TIMEOUT}s" >/dev/null || { rm -f "$bootstrap_manifest"; return 1; }
  kubectl create -f "$bootstrap_manifest" -n "$NAMESPACE" >/dev/null || { rm -f "$bootstrap_manifest"; return 1; }
  rm -f "$bootstrap_manifest"
  wait_for_final_kurrentdb_bootstrap_job_if_present || return $?
  log "KurrentDB restore from '$backup_id' complete."
}
