#!/usr/bin/env bash
# Suspends CNPG resources using the caller's context, suspension owner and annotation keys.
# k8s-suspend.sh supplies assert_postgres_release_resource and err from its inventory owner.
# Each function validates release ownership and the saved original state before a no-op or a
# resource-version-fenced patch. Fully recorded stopped resources need no live CNPG webhook.
# The caller owns phase ordering and final retention checks; this file only defines operations.

patch_scheduled_backup_suspended()
{
	local namespace="$1" name="$2" resource rv current original saved_original owner patch
	resource="$(kubectl --context "$CONTEXT" get "scheduledbackup/$name" --namespace "$namespace" -o json)"
	assert_postgres_release_resource "$resource" "ScheduledBackup/$namespace/$name" false
	rv="$(jq -er '.metadata.resourceVersion' <<<"$resource")"
	current="$(jq -r '.spec.suspend // false' <<<"$resource")"
	owner="$(jq -r --arg key "$SUSPENDED_BY" '.metadata.annotations[$key] // empty' <<<"$resource")"
	saved_original="$(jq -r --arg key "$ORIGINAL_SCHEDULED_BACKUP_SUSPEND" '.metadata.annotations[$key] // empty' <<<"$resource")"
	original="$saved_original"
	[[ -z "$owner" || "$owner" == "$SUSPENSION_OWNER" ]] || { err "ScheduledBackup/$namespace/$name has a foreign suspension owner."; exit 1; }
	if [[ -z "$original" ]]; then original="$current"; fi
	[[ "$original" == "true" || "$original" == "false" ]] || { err "ScheduledBackup/$namespace/$name has invalid saved suspend state."; exit 1; }
	[[ "$current" == "$original" || "$current" == "true" ]] || { err "ScheduledBackup/$namespace/$name changed during suspension."; exit 1; }
	if [[ "$current" == "true" && "$owner" == "$SUSPENSION_OWNER" && -n "$saved_original" ]]; then return 0; fi
	patch="$(jq -cn --arg rv "$rv" --arg key "$ORIGINAL_SCHEDULED_BACKUP_SUSPEND" --arg original "$original" --arg owner_key "$SUSPENDED_BY" --arg owner "$SUSPENSION_OWNER" '{metadata:{resourceVersion:$rv,annotations:{($key):$original,($owner_key):$owner}},spec:{suspend:true}}')"
	kubectl --context "$CONTEXT" patch "scheduledbackup/$name" --namespace "$namespace" --type=merge -p "$patch" >/dev/null
}

patch_pooler_zero()
{
	local namespace="$1" name="$2" resource rv current original saved_original owner patch
	resource="$(kubectl --context "$CONTEXT" get "pooler/$name" --namespace "$namespace" -o json)"
	assert_postgres_release_resource "$resource" "Pooler/$namespace/$name" true
	rv="$(jq -er '.metadata.resourceVersion' <<<"$resource")"
	current="$(jq -er '.spec.instances' <<<"$resource")"
	owner="$(jq -r --arg key "$SUSPENDED_BY" '.metadata.annotations[$key] // empty' <<<"$resource")"
	saved_original="$(jq -r --arg key "$ORIGINAL_POOLER_INSTANCES" '.metadata.annotations[$key] // empty' <<<"$resource")"
	original="$saved_original"
	[[ -z "$owner" || "$owner" == "$SUSPENSION_OWNER" ]] || { err "Pooler/$namespace/$name has a foreign suspension owner."; exit 1; }
	if [[ -z "$original" ]]; then original="$current"; fi
	[[ "$original" =~ ^[1-9][0-9]*$ ]] || { err "Pooler/$namespace/$name has invalid saved instances."; exit 1; }
	[[ "$current" == "$original" || "$current" == "0" ]] || { err "Pooler/$namespace/$name changed during suspension."; exit 1; }
	if [[ "$current" == "0" && "$owner" == "$SUSPENSION_OWNER" && -n "$saved_original" ]]; then return 0; fi
	patch="$(jq -cn --arg rv "$rv" --arg key "$ORIGINAL_POOLER_INSTANCES" --arg original "$original" --arg owner_key "$SUSPENDED_BY" --arg owner "$SUSPENSION_OWNER" '{metadata:{resourceVersion:$rv,annotations:{($key):$original,($owner_key):$owner}},spec:{instances:0}}')"
	kubectl --context "$CONTEXT" patch "pooler/$name" --namespace "$namespace" --type=merge -p "$patch" >/dev/null
}

hibernate_cluster()
{
	local namespace="$1" name="$2" resource rv current original saved_original owner patch
	resource="$(kubectl --context "$CONTEXT" get "cluster/$name" --namespace "$namespace" -o json)"
	assert_postgres_release_resource "$resource" "Cluster/$namespace/$name" true
	rv="$(jq -er '.metadata.resourceVersion' <<<"$resource")"
	current="$(jq -r '.metadata.annotations["cnpg.io/hibernation"] // "absent"' <<<"$resource")"
	owner="$(jq -r --arg key "$SUSPENDED_BY" '.metadata.annotations[$key] // empty' <<<"$resource")"
	saved_original="$(jq -r --arg key "$ORIGINAL_HIBERNATION" '.metadata.annotations[$key] // empty' <<<"$resource")"
	original="$saved_original"
	[[ -z "$owner" || "$owner" == "$SUSPENSION_OWNER" ]] || { err "Cluster/$namespace/$name has a foreign suspension owner."; exit 1; }
	if [[ -z "$original" ]]; then original="$current"; fi
	[[ "$original" == "absent" || "$original" == "off" || "$original" == "on" ]] || { err "Cluster/$namespace/$name has invalid saved hibernation state."; exit 1; }
	[[ "$current" == "$original" || "$current" == "on" ]] || { err "Cluster/$namespace/$name hibernation changed during suspension."; exit 1; }
	if [[ "$current" == "on" && "$owner" == "$SUSPENSION_OWNER" && -n "$saved_original" ]]; then return 0; fi
	patch="$(jq -cn --arg rv "$rv" --arg key "$ORIGINAL_HIBERNATION" --arg original "$original" --arg owner_key "$SUSPENDED_BY" --arg owner "$SUSPENSION_OWNER" '{metadata:{resourceVersion:$rv,annotations:{($key):$original,($owner_key):$owner,"cnpg.io/hibernation":"on"}}}')"
	kubectl --context "$CONTEXT" patch "cluster/$name" --namespace "$namespace" --type=merge -p "$patch" >/dev/null
}
