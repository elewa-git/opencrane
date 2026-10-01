#!/usr/bin/env bash
# Stop compute for one reviewed development test fleet while preserving its durable Kubernetes data.
set -euo pipefail

CONTEXT=""
INVENTORY=""
CONFIRM_SUSPEND=""
SETTLE_TIMEOUT_SECONDS="600"
PREFLIGHT="0"
SUSPENSION_OWNER="opencrane-test-silo-suspension-v1"
ORIGINAL_REPLICAS="opencrane.ai/suspend-original-replicas"
ORIGINAL_CRONJOB_SUSPEND="opencrane.ai/suspend-original-cronjob-suspend"
ORIGINAL_SCHEDULED_BACKUP_SUSPEND="opencrane.ai/suspend-original-scheduled-backup-suspend"
ORIGINAL_POOLER_INSTANCES="opencrane.ai/suspend-original-pooler-instances"
ORIGINAL_HIBERNATION="opencrane.ai/suspend-original-cnpg-hibernation"
SUSPENDED_BY="opencrane.ai/suspended-by"

log()
{
	printf '\033[0;32m[k8s-suspend]\033[0m %s\n' "$1"
}

err()
{
	printf '\033[0;31m[k8s-suspend]\033[0m %s\n' "$1" >&2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--context) CONTEXT="$2"; shift 2 ;;
		--inventory) INVENTORY="$2"; shift 2 ;;
		--confirm-suspend) CONFIRM_SUSPEND="$2"; shift 2 ;;
		--settle-timeout-seconds) SETTLE_TIMEOUT_SECONDS="$2"; shift 2 ;;
		--preflight) PREFLIGHT="1"; shift ;;
		-h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) err "Unknown flag: $1"; exit 1 ;;
	esac
done

for command_name in cmp date helm jq kubectl mktemp sleep; do
	command -v "$command_name" >/dev/null 2>&1 || { err "Missing required command: $command_name"; exit 1; }
done
[[ -f "$INVENTORY" ]] || { err "--inventory must name the reviewed test-silo inventory."; exit 1; }
[[ "$SETTLE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { err "--settle-timeout-seconds must be positive."; exit 1; }
(( SETTLE_TIMEOUT_SECONDS <= 3600 )) || { err "--settle-timeout-seconds must not exceed 3600."; exit 1; }

EXPECTED_CONTEXT="$(jq -er '.context' "$INVENTORY")" || { err "Inventory context is missing."; exit 1; }
EXPECTED_CONFIRMATION="$(jq -er '.confirmation' "$INVENTORY")" || { err "Inventory confirmation is missing."; exit 1; }
[[ "$CONTEXT" == "$EXPECTED_CONTEXT" ]] || { err "Only reviewed context '$EXPECTED_CONTEXT' may be suspended."; exit 1; }
[[ "$CONFIRM_SUSPEND" == "$EXPECTED_CONFIRMATION" ]] || {
	err "--confirm-suspend must exactly match '$EXPECTED_CONFIRMATION'."
	exit 1
}
[[ "$(kubectl config current-context)" == "$CONTEXT" ]] || { err "kubectl context does not match '$CONTEXT'."; exit 1; }
[[ "$(jq '.clusterTenants | length' "$INVENTORY")" == "6" ]] || { err "Inventory must contain exactly six test silos."; exit 1; }
[[ "$(jq '[.clusterTenants[].name] | unique | length' "$INVENTORY")" == "6" ]] || { err "Inventory contains duplicate test silos."; exit 1; }
jq -e '
	.clusterTenants | all(
		.name | test("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")
	) and all(
		.mainChart | test("^opencrane-silo-[0-9]+\\.[0-9]+\\.[0-9]+$")
	) and all(
		.postgresChart | test("^postgres-[0-9]+\\.[0-9]+\\.[0-9]+$")
	) and all(
		.retainedPersistentVolumeCount > 0 and .retainedStorageGi > 0
	)
' "$INVENTORY" >/dev/null || { err "Inventory contains an invalid silo contract."; exit 1; }

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-suspend.XXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT
CONTROLLERS="$WORK_DIR/controllers.json"
NAMESPACES="$WORK_DIR/namespaces.json"
CNPG="$WORK_DIR/cnpg.json"
SANDBOX_CLAIMS="$WORK_DIR/sandbox-claims.json"
SANDBOXES="$WORK_DIR/sandboxes.json"
PODS="$WORK_DIR/pods.json"
INGRESSES="$WORK_DIR/ingresses.json"
DEPLOYMENT_ACTIONS="$WORK_DIR/deployments.tsv"
EXTERNAL_DEPLOYMENT_ACTIONS="$WORK_DIR/external-deployments.tsv"
STATEFULSET_ACTIONS="$WORK_DIR/statefulsets.tsv"
CRONJOB_ACTIONS="$WORK_DIR/cronjobs.tsv"
POOLER_ACTIONS="$WORK_DIR/poolers.tsv"
CLUSTER_ACTIONS="$WORK_DIR/clusters.tsv"
SCHEDULED_BACKUP_ACTIONS="$WORK_DIR/scheduled-backups.tsv"
OWNED_NAMESPACES="$WORK_DIR/namespaces.txt"
: >"$DEPLOYMENT_ACTIONS"
: >"$EXTERNAL_DEPLOYMENT_ACTIONS"
: >"$STATEFULSET_ACTIONS"
: >"$CRONJOB_ACTIONS"
: >"$POOLER_ACTIONS"
: >"$CLUSTER_ACTIONS"
: >"$SCHEDULED_BACKUP_ACTIONS"
: >"$OWNED_NAMESPACES"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/k8s-suspend-inventory.sh"
source "$SCRIPT_DIR/k8s-suspend-postgres.sh"

read_cluster_inventory
TARGET_NAMESPACE_PREFIXES="$(jq -c '[.clusterTenants[].name | "opencrane-" + .]' "$INVENTORY")"
discover_owned_namespaces
while IFS=$'\t' read -r tenant main_chart postgres_chart retained_count retained_gi; do
	namespace="opencrane-${tenant}"
	[[ "$(kubectl --context "$CONTEXT" get "namespace/$namespace" --ignore-not-found -o name)" == "namespace/$namespace" ]] || {
		err "Target namespace '$namespace' is absent."
		exit 1
	}
	assert_release_chart "$namespace" "$namespace" "$main_chart"
	assert_release_chart "$namespace" "${namespace}-postgres" "$postgres_chart"
	append_app_actions "$tenant"
	append_cnpg_actions "$tenant"
	assert_retained_storage_contract "$tenant" "$retained_count" "$retained_gi"
done < <(jq -r '.clusterTenants[] | [.name,.mainChart,.postgresChart,.retainedPersistentVolumeCount,.retainedStorageGi] | @tsv' "$INVENTORY")
append_external_deployment_actions

TARGET_RELEASES="$(jq -c '[.clusterTenants[].name | {namespace:("opencrane-" + .),app:("opencrane-" + .),postgres:("opencrane-" + . + "-postgres"),pooler:("opencrane-" + . + "-postgres-pooler")}]' "$INVENTORY")"
EXTERNAL_DEPLOYMENTS="$(jq -c '.externalDeployments' "$INVENTORY")"
foreign_controllers="$(jq -r --rawfile namespaces "$OWNED_NAMESPACES" --argjson targets "$TARGET_RELEASES" --argjson external "$EXTERNAL_DEPLOYMENTS" '
	($namespaces | split("\n") | map(select(length > 0))) as $owned |
	.items[] as $item |
	select($item.metadata.namespace as $namespace | $owned | index($namespace)) |
	select($item.kind != "Job" or (($item.status.active // 0) > 0)) |
	select(
		($targets | map(. as $target |
			$item.metadata.annotations["meta.helm.sh/release-namespace"] == $target.namespace and
			($item.metadata.annotations["meta.helm.sh/release-name"] == $target.app or
			 $item.metadata.annotations["meta.helm.sh/release-name"] == $target.postgres)) | any) or
		($targets | map(. as $target |
			$item.metadata.namespace == $target.namespace and
			([$item.metadata.ownerReferences[]? | select(.controller == true and .kind == "Pooler" and .name == $target.pooler)] | length == 1)) | any) or
		($external | map(. as $expected |
			$item.kind == "Deployment" and $item.metadata.namespace == $expected.namespace and
			$item.metadata.name == $expected.name and $item.metadata.uid == $expected.uid) | any)
		| not
	) |
	"\($item.kind)/\($item.metadata.namespace)/\($item.metadata.name)"
' "$CONTROLLERS")"
[[ -z "$foreign_controllers" ]] || { err "Unknown or foreign active controllers exist in owned namespaces: $foreign_controllers"; exit 1; }

[[ "$(wc -l <"$CLUSTER_ACTIONS" | tr -d ' ')" == "6" ]] || { err "Expected six owned CNPG clusters."; exit 1; }
[[ "$(wc -l <"$POOLER_ACTIONS" | tr -d ' ')" == "6" ]] || { err "Expected six owned CNPG poolers."; exit 1; }
assert_shared_deployment_contracts

standalone_active_pods="$(jq -r --rawfile namespaces "$OWNED_NAMESPACES" '
	($namespaces | split("\n") | map(select(length > 0))) as $owned |
	[.items[] |
	 select(.metadata.namespace as $namespace | $owned | index($namespace)) |
	 select(.status.phase == "Pending" or .status.phase == "Running" or .status.phase == "Unknown") |
	 select([.metadata.ownerReferences[]? | select(.controller == true)] | length != 1) |
	 "\(.metadata.namespace)/\(.metadata.name)"] | join(",")
' "$PODS")"
[[ -z "$standalone_active_pods" ]] || { err "Standalone or ambiguously owned active Pods prevent suspension: $standalone_active_pods"; exit 1; }
for sandbox_inventory in "$SANDBOX_CLAIMS" "$SANDBOXES"; do
	untargeted="$(jq -r --argjson prefixes "$TARGET_NAMESPACE_PREFIXES" '
		[.items[] | .metadata.namespace as $namespace |
		 select(($prefixes | map(. as $prefix | $namespace == $prefix or ($namespace | startswith($prefix + "-"))) | any) | not) |
		 "\(.kind)/\(.metadata.namespace)/\(.metadata.name)"] | join(",")
	' "$sandbox_inventory")"
	[[ -z "$untargeted" ]] || { err "Untargeted Agent Sandbox resources prevent shared-controller suspension: $untargeted"; exit 1; }
done
write_sandbox_suspension_actions "$WORK_DIR/sandbox-actions-preflight.tsv"
[[ "$(jq '.items | length' "$INGRESSES")" == "6" ]] || { err "Expected exactly six cluster Ingresses before stopping shared ingress."; exit 1; }
while IFS=$'\t' read -r tenant _main _postgres _count _gi; do
	namespace="opencrane-${tenant}"
	[[ "$(jq -r --arg namespace "$namespace" --arg release "$namespace" '[.items[] | select(.metadata.namespace == $namespace) | select(.metadata.annotations["meta.helm.sh/release-name"] == $release) | select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace)] | length' "$INGRESSES")" == "1" ]] || {
		err "Ingress ownership for '$tenant' is incomplete or ambiguous."
		exit 1
	}
done < <(jq -r '.clusterTenants[] | [.name,.mainChart,.postgresChart,.retainedPersistentVolumeCount,.retainedStorageGi] | @tsv' "$INVENTORY")
retention_snapshot "$WORK_DIR/retention-before.json"

log "Inventory accepted for six silos in '$CONTEXT'."
log "Planned application controllers: $(wc -l <"$DEPLOYMENT_ACTIONS" | tr -d ' ') Deployments, $(wc -l <"$STATEFULSET_ACTIONS" | tr -d ' ') StatefulSets, $(wc -l <"$CRONJOB_ACTIONS" | tr -d ' ') CronJobs."
if [[ "$PREFLIGHT" == "1" ]]; then
	log "Preflight complete; no Kubernetes resources changed."
	exit 0
fi

patch_replicas_zero()
{
	local kind="$1" namespace="$2" name="$3" ownership="${4:-application}"
	local resource resource_version current original owner patch
	resource="$(kubectl --context "$CONTEXT" get "$kind/$name" --namespace "$namespace" -o json)"
	if [[ "$ownership" == "application" ]]; then
		assert_application_release_resource "$resource" "$kind/$namespace/$name"
	elif [[ "$ownership" == "shared" ]]; then
		contract="$(jq -ce --arg namespace "$namespace" --arg name "$name" '[.sharedDeployments[] | select(.namespace == $namespace and .name == $name)] | if length == 1 then .[0] else error("missing shared deployment contract") end' "$INVENTORY")" || {
			err "Shared Deployment/$namespace/$name has no exact inventory contract."
			exit 1
		}
		assert_reviewed_deployment_resource "$contract" "$resource" Shared
	else
		contract="$(jq -ce --arg namespace "$namespace" --arg name "$name" '[.externalDeployments[] | select(.namespace == $namespace and .name == $name)] | if length == 1 then .[0] else error("missing external deployment contract") end' "$INVENTORY")" || {
			err "External Deployment/$namespace/$name has no exact inventory contract."
			exit 1
		}
		assert_reviewed_deployment_resource "$contract" "$resource" External
	fi
	resource_version="$(jq -er '.metadata.resourceVersion' <<<"$resource")"
	current="$(jq -er '.spec.replicas // 1' <<<"$resource")"
	owner="$(jq -r --arg key "$SUSPENDED_BY" '.metadata.annotations[$key] // empty' <<<"$resource")"
	original="$(jq -r --arg key "$ORIGINAL_REPLICAS" '.metadata.annotations[$key] // empty' <<<"$resource")"
	[[ -z "$owner" || "$owner" == "$SUSPENSION_OWNER" ]] || { err "$kind/$namespace/$name has a foreign suspension owner."; exit 1; }
	if [[ -z "$original" ]]; then original="$current"; fi
	[[ "$original" =~ ^[0-9]+$ ]] || { err "$kind/$namespace/$name has invalid saved replicas."; exit 1; }
	[[ "$current" == "$original" || "$current" == "0" ]] || { err "$kind/$namespace/$name replicas changed during suspension."; exit 1; }
	patch="$(jq -cn --arg rv "$resource_version" --arg key "$ORIGINAL_REPLICAS" --arg original "$original" --arg owner_key "$SUSPENDED_BY" --arg owner "$SUSPENSION_OWNER" '{metadata:{resourceVersion:$rv,annotations:{($key):$original,($owner_key):$owner}},spec:{replicas:0}}')"
	kubectl --context "$CONTEXT" patch "$kind/$name" --namespace "$namespace" --type=merge -p "$patch" >/dev/null
}

patch_cronjob_suspended()
{
	local namespace="$1" name="$2" resource rv current original owner patch
	resource="$(kubectl --context "$CONTEXT" get "cronjob/$name" --namespace "$namespace" -o json)"
	assert_application_release_resource "$resource" "CronJob/$namespace/$name"
	rv="$(jq -er '.metadata.resourceVersion' <<<"$resource")"
	current="$(jq -r '.spec.suspend // false' <<<"$resource")"
	owner="$(jq -r --arg key "$SUSPENDED_BY" '.metadata.annotations[$key] // empty' <<<"$resource")"
	original="$(jq -r --arg key "$ORIGINAL_CRONJOB_SUSPEND" '.metadata.annotations[$key] // empty' <<<"$resource")"
	[[ -z "$owner" || "$owner" == "$SUSPENSION_OWNER" ]] || { err "CronJob/$namespace/$name has a foreign suspension owner."; exit 1; }
	if [[ -z "$original" ]]; then original="$current"; fi
	[[ "$original" == "true" || "$original" == "false" ]] || { err "CronJob/$namespace/$name has invalid saved suspend state."; exit 1; }
	[[ "$current" == "$original" || "$current" == "true" ]] || { err "CronJob/$namespace/$name changed during suspension."; exit 1; }
	patch="$(jq -cn --arg rv "$rv" --arg key "$ORIGINAL_CRONJOB_SUSPEND" --arg original "$original" --arg owner_key "$SUSPENDED_BY" --arg owner "$SUSPENSION_OWNER" '{metadata:{resourceVersion:$rv,annotations:{($key):$original,($owner_key):$owner}},spec:{suspend:true}}')"
	kubectl --context "$CONTEXT" patch "cronjob/$name" --namespace "$namespace" --type=merge -p "$patch" >/dev/null
}

while IFS=$'\t' read -r namespace name; do
	[[ -z "$namespace" ]] || patch_cronjob_suspended "$namespace" "$name"
done <"$CRONJOB_ACTIONS"

deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while true; do
	read_cluster_inventory
	active_jobs="$(jq -r --rawfile namespaces "$OWNED_NAMESPACES" '
		($namespaces | split("\n") | map(select(length > 0))) as $owned |
		[.items[] | select(.kind == "Job" and ((.status.active // 0) > 0)) | select(.metadata.namespace as $n | $owned | index($n)) | "\(.metadata.namespace)/\(.metadata.name)"] | join(",")
	' "$CONTROLLERS")"
	[[ -n "$active_jobs" ]] || break
	if (( $(date +%s) >= deadline )); then
		err "Active Jobs did not settle before the timeout: $active_jobs"
		exit 1
	fi
	log "Waiting for active Jobs to settle: $active_jobs"
	sleep 5
done

while IFS=$'\t' read -r namespace name; do
	[[ -z "$namespace" ]] || patch_replicas_zero deployment "$namespace" "$name"
done <"$DEPLOYMENT_ACTIONS"
while IFS=$'\t' read -r namespace name; do
	[[ -z "$namespace" ]] || patch_replicas_zero deployment "$namespace" "$name" external
done <"$EXTERNAL_DEPLOYMENT_ACTIONS"

# Sandbox claims are retained. If expiry has not removed them, stop the shared controller, persist
# each surviving Sandbox as Suspended, then remove only a freshly revalidated ephemeral Pod.
deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while true; do
	read_cluster_inventory
	remaining_claims="$(jq '.items | length' "$SANDBOX_CLAIMS")"
	[[ "$remaining_claims" == "0" ]] && break
	(( $(date +%s) < deadline )) || break
	log "Waiting for $remaining_claims SandboxClaims to expire after server suspension."
	sleep 5
done

scale_shared_deployment_zero()
{
	local namespace="$1" name="$2"
	patch_replicas_zero deployment "$namespace" "$name" shared
}

wait_for_shared_deployment_stopped()
{
	local namespace="$1" name="$2" contract deployment
	contract="$(jq -ce --arg namespace "$namespace" --arg name "$name" '[.sharedDeployments[] | select(.namespace == $namespace and .name == $name)] | if length == 1 then .[0] else error("missing shared deployment contract") end' "$INVENTORY")" || {
		err "Shared Deployment/$namespace/$name has no exact inventory contract."
		exit 1
	}
	deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
	while true; do
		deployment="$(kubectl --context "$CONTEXT" get "deployment/$name" --namespace "$namespace" -o json)"
		assert_reviewed_deployment_resource "$contract" "$deployment" Shared
		if jq -e '.spec.replicas == 0 and (.status.readyReplicas // 0) == 0 and (.status.availableReplicas // 0) == 0' <<<"$deployment" >/dev/null; then
			break
		fi
		(( $(date +%s) < deadline )) || { err "Shared Deployment/$namespace/$name did not stop before Sandbox suspension."; exit 1; }
		sleep 5
	done
}

read_exact_sandbox_pair()
{
	local namespace="$1" claim_name="$2" claim_uid="$3" sandbox_name="$4" sandbox_uid="$5"
	LIVE_SANDBOX_CLAIM="$(kubectl --context "$CONTEXT" get "sandboxclaims.extensions.agents.x-k8s.io/$claim_name" --namespace "$namespace" -o json)" || {
		err "Cannot re-read SandboxClaim/$namespace/$claim_name."
		exit 1
	}
	jq -e --arg namespace "$namespace" --arg name "$claim_name" --arg uid "$claim_uid" --arg sandbox "$sandbox_name" '
		.metadata.namespace == $namespace and .metadata.name == $name and .metadata.uid == $uid and
		.status.sandbox.name == $sandbox
	' <<<"$LIVE_SANDBOX_CLAIM" >/dev/null || {
		err "SandboxClaim/$namespace/$claim_name identity or Sandbox assignment changed during suspension."
		exit 1
	}

	LIVE_SANDBOX="$(kubectl --context "$CONTEXT" get "sandboxes.agents.x-k8s.io/$sandbox_name" --namespace "$namespace" -o json)" || {
		err "Cannot re-read Sandbox/$namespace/$sandbox_name."
		exit 1
	}
	jq -e --arg namespace "$namespace" --arg name "$sandbox_name" --arg uid "$sandbox_uid" --arg claim "$claim_name" --arg claim_uid "$claim_uid" '
		.metadata.namespace == $namespace and .metadata.name == $name and .metadata.uid == $uid and
		([.metadata.ownerReferences[]? | select(.controller == true)] | length) == 1 and
		([.metadata.ownerReferences[]? | select(.controller == true and .kind == "SandboxClaim" and .name == $claim and .uid == $claim_uid)] | length) == 1 and
		(.spec.volumeClaimTemplates // [] | length) == 0 and
		(.spec.podTemplate.spec.volumes // [] | map(select(.persistentVolumeClaim != null)) | length) == 0
	' <<<"$LIVE_SANDBOX" >/dev/null || {
		err "Sandbox/$namespace/$sandbox_name identity, Claim ownership or durable volume contract changed during suspension."
		exit 1
	}
}

suspend_sandbox_and_delete_ephemeral_pod()
{
	local namespace="$1" claim_name="$2" claim_uid="$3" sandbox_name="$4" sandbox_uid="$5"
	local sandbox_rv patch pod pod_uid delete_options
	read_exact_sandbox_pair "$namespace" "$claim_name" "$claim_uid" "$sandbox_name" "$sandbox_uid"
	sandbox_rv="$(jq -er '.metadata.resourceVersion' <<<"$LIVE_SANDBOX")"
	# Agent Sandbox v0.5.3 treats Suspended as durable desired state and will not recreate its Pod.
	patch="$(jq -cn --arg uid "$sandbox_uid" --arg rv "$sandbox_rv" '[
		{op:"test",path:"/metadata/uid",value:$uid},
		{op:"test",path:"/metadata/resourceVersion",value:$rv},
		{op:"add",path:"/spec/operatingMode",value:"Suspended"}
	]')"
	kubectl --context "$CONTEXT" patch "sandboxes.agents.x-k8s.io/$sandbox_name" --namespace "$namespace" --type=json -p "$patch" >/dev/null

	read_exact_sandbox_pair "$namespace" "$claim_name" "$claim_uid" "$sandbox_name" "$sandbox_uid"
	[[ "$(jq -r '.spec.operatingMode // "Running"' <<<"$LIVE_SANDBOX")" == "Suspended" ]] || {
		err "Sandbox/$namespace/$sandbox_name did not persist Suspended operating mode."
		exit 1
	}
	pod="$(kubectl --context "$CONTEXT" get "pod/$sandbox_name" --namespace "$namespace" --ignore-not-found -o json)"
	[[ -n "$pod" ]] || return 0
	jq -e --arg namespace "$namespace" --arg name "$sandbox_name" --arg uid "$sandbox_uid" '
		.metadata.namespace == $namespace and .metadata.name == $name and
		([.metadata.ownerReferences[]? | select(.controller == true)] | length) == 1 and
		([.metadata.ownerReferences[]? | select(.controller == true and .kind == "Sandbox" and .name == $name and .uid == $uid)] | length) == 1 and
		(.spec.volumes // [] | map(select(.persistentVolumeClaim != null)) | length) == 0 and
		.spec.terminationGracePeriodSeconds == 0
	' <<<"$pod" >/dev/null || { err "Sandbox Pod '$namespace/$sandbox_name' is not disposable or has an invalid owner."; exit 1; }
	pod_uid="$(jq -er '.metadata.uid' <<<"$pod")"
	delete_options="$(jq -cn --arg uid "$pod_uid" '{apiVersion:"v1",kind:"DeleteOptions",gracePeriodSeconds:0,propagationPolicy:"Background",preconditions:{uid:$uid}}')"
	printf '%s' "$delete_options" | kubectl --context "$CONTEXT" delete --raw "/api/v1/namespaces/${namespace}/pods/${sandbox_name}" -f - >/dev/null
}

if [[ "$remaining_claims" != "0" ]]; then
	untargeted="$(jq -r --rawfile namespaces "$OWNED_NAMESPACES" '($namespaces | split("\n") | map(select(length > 0))) as $owned | [.items[] | select((.metadata.namespace as $n | $owned | index($n)) | not) | "\(.metadata.namespace)/\(.metadata.name)"] | join(",")' "$SANDBOX_CLAIMS")"
	[[ -z "$untargeted" ]] || { err "Untargeted SandboxClaims prevent shared controller suspension: $untargeted"; exit 1; }
	scale_shared_deployment_zero agent-sandbox-system agent-sandbox-controller
	wait_for_shared_deployment_stopped agent-sandbox-system agent-sandbox-controller
	read_cluster_inventory
	write_sandbox_suspension_actions "$WORK_DIR/sandbox-actions.tsv"
	while IFS=$'\t' read -r namespace claim_name claim_uid sandbox_name sandbox_uid; do
		suspend_sandbox_and_delete_ephemeral_pod "$namespace" "$claim_name" "$claim_uid" "$sandbox_name" "$sandbox_uid"
	done <"$WORK_DIR/sandbox-actions.tsv"
else
	scale_shared_deployment_zero agent-sandbox-system agent-sandbox-controller
fi

while IFS=$'\t' read -r namespace name; do
	[[ -z "$namespace" ]] || patch_scheduled_backup_suspended "$namespace" "$name"
done <"$SCHEDULED_BACKUP_ACTIONS"

while IFS=$'\t' read -r namespace name; do patch_pooler_zero "$namespace" "$name"; done <"$POOLER_ACTIONS"

while IFS=$'\t' read -r namespace name; do hibernate_cluster "$namespace" "$name"; done <"$CLUSTER_ACTIONS"

deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while IFS=$'\t' read -r namespace name; do
	while true; do
		cluster="$(kubectl --context "$CONTEXT" get "cluster/$name" --namespace "$namespace" -o json)"
		if jq -e '([.status.conditions[]? | select(.type == "cnpg.io/hibernation" and .status == "True")] | length == 1) and (.status.readyInstances // 0) == 0' <<<"$cluster" >/dev/null; then
			break
		fi
		(( $(date +%s) < deadline )) || { err "Cluster/$namespace/$name did not hibernate before the timeout."; exit 1; }
		sleep 5
	done
done <"$CLUSTER_ACTIONS"

while IFS=$'\t' read -r namespace name; do
	[[ -z "$namespace" ]] || patch_replicas_zero statefulset "$namespace" "$name"
done <"$STATEFULSET_ACTIONS"

# Shared prerequisites stop only after every tenant database is hibernated and no untargeted
# Ingress exists. Services, load-balancer addresses and every persistent object remain intact.
deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while true; do
	poolers_stopped="1"
	while IFS=$'\t' read -r namespace name; do
		pooler="$(kubectl --context "$CONTEXT" get "pooler/$name" --namespace "$namespace" -o json)"
		if ! jq -e '.spec.instances == 0 and (.status.instances // 0) == 0 and (.status.readyInstances // 0) == 0' <<<"$pooler" >/dev/null; then
			poolers_stopped="0"
		fi
	done <"$POOLER_ACTIONS"
	[[ "$poolers_stopped" == "1" ]] && break
	(( $(date +%s) < deadline )) || { err "CNPG poolers did not stop before the timeout."; exit 1; }
	sleep 5
done

deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while true; do
	kubectl --context "$CONTEXT" get pods --all-namespaces -o json >"$PODS"
	active_target_pods="$(jq -r --argjson prefixes "$TARGET_NAMESPACE_PREFIXES" '
		[.items[] | .metadata.namespace as $namespace |
		 select($prefixes | map(. as $prefix | $namespace == $prefix or ($namespace | startswith($prefix + "-"))) | any) |
		 select(.status.phase == "Pending" or .status.phase == "Running" or .status.phase == "Unknown") |
		 "\(.metadata.namespace)/\(.metadata.name)"] | join(",")
	' "$PODS")"
	[[ -z "$active_target_pods" ]] && break
	(( $(date +%s) < deadline )) || { err "Target Pods did not stop before the timeout: $active_target_pods"; exit 1; }
	sleep 5
done

while IFS=$'\t' read -r namespace name; do
	scale_shared_deployment_zero "$namespace" "$name"
done < <(jq -r '.sharedDeployments[] | [.namespace,.name] | @tsv' "$INVENTORY")

deadline=$(( $(date +%s) + SETTLE_TIMEOUT_SECONDS ))
while true; do
	shared_running=""
	while IFS=$'\t' read -r namespace name; do
		deployment="$(kubectl --context "$CONTEXT" get "deployment/$name" --namespace "$namespace" -o json)"
		if ! jq -e '.spec.replicas == 0 and (.status.readyReplicas // 0) == 0 and (.status.availableReplicas // 0) == 0' <<<"$deployment" >/dev/null; then
			shared_running="${shared_running}${namespace}/${name},"
		fi
	done < <(jq -r '.sharedDeployments[] | [.namespace,.name] | @tsv' "$INVENTORY")
	[[ -z "$shared_running" ]] && break
	(( $(date +%s) < deadline )) || { err "Shared controllers did not stop before the timeout: $shared_running"; exit 1; }
	sleep 5
done

retention_snapshot "$WORK_DIR/retention-after.json"
cmp -s "$WORK_DIR/retention-before.json" "$WORK_DIR/retention-after.json" || {
	err "A retained PVC, PV, Secret, VolumeSnapshot or VolumeSnapshotContent identity changed during suspension."
	exit 1
}

log "Suspended six OpenCrane development test silos. Claims, Sandboxes, databases, PVCs, PVs, snapshots, Secrets, Services, load-balancer address and durable history were retained."
log "The retained load-balancer, Kubernetes control plane and 380Gi of persistent disks can continue to incur cloud cost."
