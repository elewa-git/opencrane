#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 || "$#" -gt 4 ]]; then
	echo "usage: $0 <namespace> <postgres-release> <timeout-seconds> [--preflight]" >&2
	exit 64
fi

namespace="$1"
postgres_release="$2"
timeout_seconds="$3"
mode="${4:-create}"
if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || (( timeout_seconds > 3600 )); then
	echo "timeout-seconds must be an integer from 1 through 3600" >&2
	exit 64
fi
if [[ "$mode" != "create" && "$mode" != "--preflight" ]]; then
	echo "the optional mode must be --preflight" >&2
	exit 64
fi
scheduled_backup_json="$(kubectl get scheduledbackup "$postgres_release" --namespace "$namespace" -o json)" || {
	echo "automatic database mutation requires the chart-owned ScheduledBackup '$postgres_release'" >&2
	exit 1
}

if [[ "$(jq -r '.spec.method // empty' <<<"$scheduled_backup_json")" != "plugin" \
	|| -z "$(jq -r '.spec.pluginConfiguration.name // empty' <<<"$scheduled_backup_json")" ]]; then
	echo "automatic database mutation requires an enabled plugin-backed CNPG ScheduledBackup" >&2
	exit 1
fi
# The pre-fence caller checks capability without creating a Backup. A create invocation fetches the
# ScheduledBackup again after fencing so a provider change still stops the migration.
# @see https://cloudnative-pg.io/docs/1.27/backup/
if [[ "$mode" == "--preflight" ]]; then
	printf '%s\n' "$postgres_release"
	exit 0
fi

backup_suffix="-pre-migration-$(date -u +%Y%m%d%H%M%S)-$$"
backup_prefix="${postgres_release:0:$((63 - ${#backup_suffix}))}"
backup_prefix="${backup_prefix%-}"
backup_name="${backup_prefix}${backup_suffix}"
jq -n \
	--arg name "$backup_name" \
	--arg namespace "$namespace" \
	--arg cluster "$postgres_release" \
	--argjson pluginConfiguration "$(jq '.spec.pluginConfiguration' <<<"$scheduled_backup_json")" \
	'{apiVersion: "postgresql.cnpg.io/v1", kind: "Backup", metadata: {name: $name, namespace: $namespace, labels: {"opencrane.ai/purpose": "pre-database-migration"}}, spec: {cluster: {name: $cluster}, method: "plugin", pluginConfiguration: $pluginConfiguration}}' \
	| kubectl create -f - >/dev/null

deadline="$(( $(date +%s) + timeout_seconds ))"
while true; do
	phase="$(kubectl get backup "$backup_name" --namespace "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
	case "$phase" in
		completed)
			backup_id="$(kubectl get backup "$backup_name" --namespace "$namespace" -o jsonpath='{.status.backupId}' 2>/dev/null || true)"
			printf '%s\t%s\n' "$backup_name" "${backup_id:-completed}"
			exit 0
			;;
		failed|error)
			kubectl get backup "$backup_name" --namespace "$namespace" -o yaml >&2 || true
			echo "pre-migration CNPG backup '$backup_name' failed" >&2
			exit 1
			;;
	esac
	if [[ "$(date +%s)" -ge "$deadline" ]]; then
		kubectl get backup "$backup_name" --namespace "$namespace" -o yaml >&2 || true
		echo "timed out waiting for pre-migration CNPG backup '$backup_name'" >&2
		exit 1
	fi
	sleep 2
done
