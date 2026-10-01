#!/usr/bin/env bash
# Inventory and retention proofs used by the bounded test-silo suspension operation.
# The caller owns command parsing and supplies the exact reviewed paths and action files.

read_cluster_inventory()
{
	kubectl --context "$CONTEXT" get namespaces -o json >"$NAMESPACES"
	kubectl --context "$CONTEXT" get deployments.apps,statefulsets.apps,daemonsets.apps,cronjobs.batch,jobs.batch \
		--all-namespaces -o json >"$CONTROLLERS"
	kubectl --context "$CONTEXT" get clusters.postgresql.cnpg.io,poolers.postgresql.cnpg.io,scheduledbackups.postgresql.cnpg.io \
		--all-namespaces -o json >"$CNPG"
	kubectl --context "$CONTEXT" get sandboxclaims.extensions.agents.x-k8s.io --all-namespaces -o json >"$SANDBOX_CLAIMS"
	kubectl --context "$CONTEXT" get sandboxes.agents.x-k8s.io --all-namespaces -o json >"$SANDBOXES"
	kubectl --context "$CONTEXT" get pods --all-namespaces -o json >"$PODS"
	kubectl --context "$CONTEXT" get ingresses.networking.k8s.io --all-namespaces -o json >"$INGRESSES"
}

discover_owned_namespaces()
{
	jq -r --argjson prefixes "$TARGET_NAMESPACE_PREFIXES" '
		.items[].metadata.name as $namespace |
		select($prefixes | map(. as $prefix |
			$namespace == $prefix or ($namespace | startswith($prefix + "-"))) | any) |
		$namespace
	' "$NAMESPACES" | sort -u >"$OWNED_NAMESPACES"
	while IFS= read -r prefix; do
		grep -Fxq "$prefix" "$OWNED_NAMESPACES" || {
			err "Target namespace '$prefix' is absent from the cluster namespace inventory."
			exit 1
		}
	done < <(jq -r '.[]' <<<"$TARGET_NAMESPACE_PREFIXES")
}

release_chart()
{
	local namespace="$1"
	local release="$2"
	local releases
	releases="$(helm list --kube-context "$CONTEXT" --namespace "$namespace" --filter "^${release}$" --output json)" || {
		err "Unable to read Helm release '$release' in '$namespace'."
		exit 1
	}
	jq -er --arg release "$release" 'if length == 1 and .[0].name == $release then .[0].chart else error("missing or duplicate release") end' <<<"$releases" || {
		err "Expected exactly one Helm release '$release' in '$namespace'."
		exit 1
	}
}

assert_release_chart()
{
	local namespace="$1"
	local release="$2"
	local expected="$3"
	local actual
	actual="$(release_chart "$namespace" "$release")"
	[[ "$actual" == "$expected" ]] || {
		err "Foreign or unexpected Helm chart '$actual' for '$release'; expected '$expected'."
		exit 1
	}
}

assert_application_release_resource()
{
	local resource="$1" description="$2"
	jq -e --argjson targets "$TARGET_RELEASES" '. as $item |
		$targets | map(. as $target |
			($item.metadata.namespace == $target.namespace or ($item.metadata.namespace | startswith($target.namespace + "-"))) and
			$item.metadata.annotations["meta.helm.sh/release-namespace"] == $target.namespace and
			$item.metadata.annotations["meta.helm.sh/release-name"] == $target.app) | any
	' <<<"$resource" >/dev/null || { err "$description lost its exact application release ownership."; exit 1; }
}

assert_postgres_release_resource()
{
	local resource="$1" description="$2" require_labels="$3"
	jq -e --argjson targets "$TARGET_RELEASES" --argjson requireLabels "$require_labels" '. as $item |
		$targets | map(. as $target |
			$item.metadata.namespace == $target.namespace and
			$item.metadata.annotations["meta.helm.sh/release-namespace"] == $target.namespace and
			$item.metadata.annotations["meta.helm.sh/release-name"] == $target.postgres and
			($requireLabels == false or
			 ($item.metadata.labels["app.kubernetes.io/instance"] == $target.postgres and
			  $item.metadata.labels["app.kubernetes.io/managed-by"] == "Helm"))) | any
	' <<<"$resource" >/dev/null || { err "$description lost its exact Postgres release ownership."; exit 1; }
}

append_app_actions()
{
	local tenant="$1"
	local namespace="opencrane-${tenant}"
	local release="$namespace"
	local postgres_release="${release}-postgres"
	local foreign
	foreign="$(jq -r --arg release "$release" --arg namespace "$namespace" --arg postgres "$postgres_release" --slurpfile inventory "$INVENTORY" '
		.items[] |
		select(.metadata.namespace == $namespace) |
		select(.kind != "Job" or ((.status.active // 0) > 0)) |
		select(((
			(.metadata.annotations["meta.helm.sh/release-name"] == $release and
			 .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) or
			(.metadata.annotations["meta.helm.sh/release-name"] == $postgres and
			 .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) or
			((.metadata.ownerReferences // []) | any(.controller == true and .kind == "Pooler" and .name == ($postgres + "-pooler"))) or
			(. as $item | $inventory[0].externalDeployments | map(
				$item.kind == "Deployment" and $item.metadata.namespace == .namespace and
				$item.metadata.name == .name and $item.metadata.uid == .uid) | any)
		) | not)) |
		"\(.kind)/\(.metadata.namespace)/\(.metadata.name)"
	' "$CONTROLLERS")"
	[[ -z "$foreign" ]] || { err "Unknown or foreign active controller in '$namespace': $foreign"; exit 1; }

	jq -r --arg release "$release" --arg namespace "$namespace" '
		.items[] | select(.kind == "Deployment") |
		select(.metadata.annotations["meta.helm.sh/release-name"] == $release) |
		select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) |
		[.metadata.namespace,.metadata.name] | @tsv
	' "$CONTROLLERS" >>"$DEPLOYMENT_ACTIONS"
	jq -r --arg release "$release" --arg namespace "$namespace" '
		.items[] | select(.kind == "StatefulSet") |
		select(.metadata.annotations["meta.helm.sh/release-name"] == $release) |
		select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) |
		[.metadata.namespace,.metadata.name] | @tsv
	' "$CONTROLLERS" >>"$STATEFULSET_ACTIONS"
	jq -r --arg release "$release" --arg namespace "$namespace" '
		.items[] | select(.kind == "CronJob") |
		select(.metadata.annotations["meta.helm.sh/release-name"] == $release) |
		select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) |
		[.metadata.namespace,.metadata.name] | @tsv
	' "$CONTROLLERS" >>"$CRONJOB_ACTIONS"
	[[ "$(jq -r --arg release "$release" --arg namespace "$namespace" '[.items[] | select(.kind == "Deployment") | select(.metadata.namespace == $namespace and .metadata.name == ($release + "-opencrane-server")) | select(.metadata.annotations["meta.helm.sh/release-name"] == $release) | select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace)] | length' "$CONTROLLERS")" == "1" ]] || {
		err "Silo '$tenant' does not have one exact Helm-owned OpenCrane server."
		exit 1
	}
}

append_cnpg_actions()
{
	local tenant="$1"
	local namespace="opencrane-${tenant}"
	local postgres_release="${namespace}-postgres"
	local kind name expected_name
	for kind in Cluster Pooler; do
		expected_name="$postgres_release"
		[[ "$kind" != "Pooler" ]] || expected_name="${postgres_release}-pooler"
		[[ "$(jq -r --arg kind "$kind" --arg name "$expected_name" --arg namespace "$namespace" --arg release "$postgres_release" '
			[.items[] | select(.kind == $kind and .metadata.name == $name and .metadata.namespace == $namespace) |
			 select(.metadata.labels["app.kubernetes.io/instance"] == $release) |
			 select(.metadata.labels["app.kubernetes.io/managed-by"] == "Helm") |
			 select(.metadata.annotations["meta.helm.sh/release-name"] == $release) |
			 select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace)] | length
		' "$CNPG")" == "1" ]] || {
			err "Cannot prove exact Postgres ownership for $kind/$namespace/$expected_name."
			exit 1
		}
	done
	printf '%s\t%s\n' "$namespace" "${postgres_release}-pooler" >>"$POOLER_ACTIONS"
	printf '%s\t%s\n' "$namespace" "$postgres_release" >>"$CLUSTER_ACTIONS"
	jq -r --arg release "$postgres_release" --arg namespace "$namespace" '
		.items[] | select(.kind == "ScheduledBackup") |
		select(.metadata.annotations["meta.helm.sh/release-name"] == $release) |
		select(.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace) |
		[.metadata.namespace,.metadata.name] | @tsv
	' "$CNPG" >>"$SCHEDULED_BACKUP_ACTIONS"
}

assert_retained_storage_contract()
{
	local tenant="$1"
	local expected_count="$2"
	local expected_gi="$3"
	local namespace="opencrane-${tenant}"
	local claims count total
	claims="$(kubectl --context "$CONTEXT" get pvc --all-namespaces -o json)" || {
		err "Cannot inventory retained claims for '$tenant'."
		exit 1
	}
	count="$(jq --arg namespace "$namespace" '[.items[] | select(.metadata.namespace == $namespace or (.metadata.namespace | startswith($namespace + "-"))) | select(.spec.volumeName != null)] | length' <<<"$claims")"
	total="$(jq --arg namespace "$namespace" '[.items[] | select(.metadata.namespace == $namespace or (.metadata.namespace | startswith($namespace + "-"))) | select(.spec.volumeName != null) | .status.capacity.storage | capture("^(?<n>[0-9]+)Gi$").n | tonumber] | add // 0' <<<"$claims")" || {
		err "Retained claim capacity in '$namespace' is not an exact Gi quantity."
		exit 1
	}
	[[ "$count" == "$expected_count" && "$total" == "$expected_gi" ]] || {
		err "Retained storage mismatch for '$tenant': expected ${expected_count} volumes/${expected_gi}Gi, found ${count}/${total}Gi."
		exit 1
	}
}

retention_snapshot()
{
	local output="$1"
	local pvc_file="$WORK_DIR/retention-pvc.json"
	local pv_file="$WORK_DIR/retention-pv.json"
	local secrets_file="$WORK_DIR/retention-secret-identities.tsv"
	local snapshots_file="$WORK_DIR/retention-snapshots.json"
	local contents_file="$WORK_DIR/retention-snapshot-contents.json"
	kubectl --context "$CONTEXT" get pvc --all-namespaces -o json >"$pvc_file"
	kubectl --context "$CONTEXT" get pv -o json >"$pv_file"
	kubectl --context "$CONTEXT" get secrets --all-namespaces \
		-o=jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{.metadata.uid}{"\n"}{end}' >"$secrets_file"
	kubectl --context "$CONTEXT" get volumesnapshots.snapshot.storage.k8s.io --all-namespaces -o json >"$snapshots_file"
	kubectl --context "$CONTEXT" get volumesnapshotcontents.snapshot.storage.k8s.io -o json >"$contents_file"
	jq -S -n --rawfile namespaces "$OWNED_NAMESPACES" --slurpfile pvc "$pvc_file" --slurpfile pv "$pv_file" \
		--rawfile secretIdentities "$secrets_file" --slurpfile snapshots "$snapshots_file" --slurpfile contents "$contents_file" '
		($namespaces | split("\n") | map(select(length > 0))) as $targetNamespaces |
		($pvc[0]) as $pvc | ($pv[0]) as $pv |
		($snapshots[0]) as $snapshots | ($contents[0]) as $contents |
		def targeted($namespace): $targetNamespaces | index($namespace);
		{
			pvc: ([$pvc.items[] | select(targeted(.metadata.namespace)) |
				{namespace:.metadata.namespace,name:.metadata.name,uid:.metadata.uid,volumeName:.spec.volumeName,capacity:.status.capacity.storage}] | sort_by(.namespace,.name)),
			pv: [$pv.items[] | select(targeted(.spec.claimRef.namespace)) |
				{name:.metadata.name,uid:.metadata.uid,claimRef:.spec.claimRef,volumeHandle:(.spec.csi.volumeHandle // null),capacity:.spec.capacity.storage}] | sort_by(.name),
			secrets: ($secretIdentities | split("\n") | map(select(length > 0) | split("\t") |
				{namespace:.[0],name:.[1],uid:.[2]} | select(targeted(.namespace))) | sort_by(.namespace,.name)),
			snapshots: [$snapshots.items[] | select(targeted(.metadata.namespace)) |
				{namespace:.metadata.namespace,name:.metadata.name,uid:.metadata.uid,bound:.status.boundVolumeSnapshotContentName,ready:.status.readyToUse}] | sort_by(.namespace,.name),
			contents: [$contents.items[] | select(targeted(.spec.volumeSnapshotRef.namespace)) |
				{name:.metadata.name,uid:.metadata.uid,ref:.spec.volumeSnapshotRef,handle:(.status.snapshotHandle // null),ready:.status.readyToUse}] | sort_by(.name)
		}
	' >"$output"
}

assert_reviewed_deployment_resource()
{
	local contract="$1" deployment="$2" scope="$3"
	local namespace name uid labels selectors image helm_release annotations images
	namespace="$(jq -er '.namespace' <<<"$contract")"
	name="$(jq -er '.name' <<<"$contract")"
	uid="$(jq -er '.uid' <<<"$contract")"
	labels="$(jq -c '.matchLabels' <<<"$contract")"
	selectors="$(jq -c '.selectorLabels' <<<"$contract")"
	image="$(jq -r '.image // empty' <<<"$contract")"
	helm_release="$(jq -r '.helmRelease // empty' <<<"$contract")"
	annotations="$(jq -c '.matchAnnotations // {}' <<<"$contract")"
	images="$(jq -c '.images // [] | sort' <<<"$contract")"
	jq -e --arg namespace "$namespace" --arg name "$name" --arg uid "$uid" --argjson labels "$labels" --argjson selectors "$selectors" --argjson annotations "$annotations" '
		. as $deployment |
		$deployment.metadata.namespace == $namespace and $deployment.metadata.name == $name and $deployment.metadata.uid == $uid and
		([$labels | to_entries[] | $deployment.metadata.labels[.key] == .value] | all) and
		([$selectors | to_entries[] | $deployment.spec.selector.matchLabels[.key] == .value] | all) and
		([$annotations | to_entries[] | $deployment.metadata.annotations[.key] == .value] | all)
	' <<<"$deployment" >/dev/null || {
		err "$scope Deployment/$namespace/$name identity or ownership markers drifted."
		exit 1
	}
	if [[ -n "$image" ]]; then
		[[ "$(jq -r '.spec.template.spec.containers[0].image' <<<"$deployment")" == "$image" ]] || {
			err "Shared Deployment/$namespace/$name does not use the reviewed image."
			exit 1
		}
	fi
	if [[ "$images" != "[]" ]]; then
		[[ "$(jq -c '[.spec.template.spec.containers[].image] | sort' <<<"$deployment")" == "$images" ]] || {
			err "$scope Deployment/$namespace/$name does not use the exact reviewed images."
			exit 1
		}
	fi
	if [[ -n "$helm_release" ]]; then
		jq -e --arg release "$helm_release" --arg namespace "$namespace" '
			.metadata.annotations["meta.helm.sh/release-name"] == $release and
			.metadata.annotations["meta.helm.sh/release-namespace"] == $namespace
		' <<<"$deployment" >/dev/null || {
			err "Shared Deployment/$namespace/$name is not owned by Helm release '$helm_release'."
			exit 1
		}
	fi
}

assert_shared_deployment_contracts()
{
	while IFS= read -r contract; do
		local namespace name deployment
		namespace="$(jq -er '.namespace' <<<"$contract")"
		name="$(jq -er '.name' <<<"$contract")"
		deployment="$(kubectl --context "$CONTEXT" get "deployment/$name" --namespace "$namespace" -o json)" || {
			err "Cannot read shared Deployment/$namespace/$name."
			exit 1
		}
		assert_reviewed_deployment_resource "$contract" "$deployment" Shared
	done < <(jq -c '.sharedDeployments[]' "$INVENTORY")
}

append_external_deployment_actions()
{
	while IFS= read -r contract; do
		local namespace name deployment
		namespace="$(jq -er '.namespace' <<<"$contract")"
		name="$(jq -er '.name' <<<"$contract")"
		deployment="$(kubectl --context "$CONTEXT" get "deployment/$name" --namespace "$namespace" -o json)" || {
			err "Cannot read reviewed external Deployment/$namespace/$name."
			exit 1
		}
		assert_reviewed_deployment_resource "$contract" "$deployment" External
		printf '%s\t%s\n' "$namespace" "$name" >>"$EXTERNAL_DEPLOYMENT_ACTIONS"
	done < <(jq -c '.externalDeployments[]' "$INVENTORY")
}

write_sandbox_suspension_actions()
{
	local output="$1"
	local claim_count sandbox_count
	local namespace claim_name claim_uid sandbox_name sandbox sandbox_uid pod pod_matches
	claim_count="$(jq '.items | length' "$SANDBOX_CLAIMS")"
	sandbox_count="$(jq '.items | length' "$SANDBOXES")"
	[[ "$sandbox_count" == "$claim_count" ]] || { err "Sandbox count does not match the retained Claim count."; exit 1; }
	jq -e '[.items[] | [.metadata.namespace,.metadata.name]] as $coordinates | ($coordinates | length) == ($coordinates | unique | length)' "$SANDBOX_CLAIMS" >/dev/null || {
		err "Duplicate SandboxClaim coordinates prevent suspension."
		exit 1
	}
	jq -e '[.items[] | [.metadata.namespace,.metadata.name]] as $coordinates | ($coordinates | length) == ($coordinates | unique | length)' "$SANDBOXES" >/dev/null || {
		err "Duplicate Sandbox coordinates prevent suspension."
		exit 1
	}
	: >"$output"
	while IFS=$'\t' read -r namespace claim_name claim_uid sandbox_name; do
		[[ -n "$sandbox_name" ]] || { err "SandboxClaim/$namespace/$claim_name has no exact Sandbox assignment."; exit 1; }
		sandbox="$(jq -c --arg namespace "$namespace" --arg name "$sandbox_name" --arg claim "$claim_name" --arg uid "$claim_uid" '
			[.items[] | select(.metadata.namespace == $namespace and .metadata.name == $name) |
			 select([.metadata.ownerReferences[]? | select(.controller == true)] | length == 1) |
			 select([.metadata.ownerReferences[]? | select(.controller == true and .kind == "SandboxClaim" and .name == $claim and .uid == $uid)] | length == 1)] |
			if length == 1 then .[0] else error("invalid sandbox owner") end
		' "$SANDBOXES")" || { err "Sandbox owner chain is invalid for '$claim_name'."; exit 1; }
		sandbox_uid="$(jq -er '.metadata.uid' <<<"$sandbox")"
		jq -e '
			(.spec.volumeClaimTemplates // [] | length) == 0 and
			(.spec.podTemplate.spec.volumes // [] | map(select(.persistentVolumeClaim != null)) | length) == 0
		' <<<"$sandbox" >/dev/null || { err "Sandbox '$namespace/$sandbox_name' has durable volume configuration."; exit 1; }
		pod_matches="$(jq -c --arg namespace "$namespace" --arg name "$sandbox_name" '[.items[] | select(.metadata.namespace == $namespace and .metadata.name == $name)]' "$PODS")"
		[[ "$(jq 'length' <<<"$pod_matches")" -le 1 ]] || { err "Duplicate Sandbox Pods exist for '$namespace/$sandbox_name'."; exit 1; }
		if [[ "$(jq 'length' <<<"$pod_matches")" == "1" ]]; then
			pod="$(jq -c '.[0]' <<<"$pod_matches")"
			jq -e --arg name "$sandbox_name" --arg uid "$sandbox_uid" '
				([.metadata.ownerReferences[]? | select(.controller == true)] | length) == 1 and
				([.metadata.ownerReferences[]? | select(.controller == true and .kind == "Sandbox" and .name == $name and .uid == $uid)] | length) == 1 and
				(.spec.volumes // [] | map(select(.persistentVolumeClaim != null)) | length) == 0 and
				.spec.terminationGracePeriodSeconds == 0
			' <<<"$pod" >/dev/null || { err "Sandbox Pod '$namespace/$sandbox_name' is not disposable or has an invalid owner."; exit 1; }
		fi
		printf '%s\t%s\t%s\t%s\t%s\n' "$namespace" "$claim_name" "$claim_uid" "$sandbox_name" "$sandbox_uid" >>"$output"
	done < <(jq -r '.items[] | [.metadata.namespace,.metadata.name,.metadata.uid,(.status.sandbox.name // "")] | @tsv' "$SANDBOX_CLAIMS")

	jq -e --rawfile namespaces "$OWNED_NAMESPACES" --slurpfile sandboxes "$SANDBOXES" '
		($namespaces | split("\n") | map(select(length > 0))) as $owned |
		[.items[] as $pod |
		 select($pod.metadata.namespace as $namespace | $owned | index($namespace)) |
		 select([ $pod.metadata.ownerReferences[]? | select(.controller == true and .kind == "Sandbox") ] | length > 0) |
		 select(
			([ $pod.metadata.ownerReferences[]? | select(.controller == true) ] | length) != 1 or
			([ $pod.metadata.ownerReferences[]? | select(.controller == true and .kind == "Sandbox") ][0]) as $owner |
			([ $sandboxes[0].items[] | select(
				.metadata.namespace == $pod.metadata.namespace and
				.metadata.name == $pod.metadata.name and
				.metadata.name == $owner.name and
				.metadata.uid == $owner.uid
			) ] | length) != 1
		 ) |
		 "\($pod.metadata.namespace)/\($pod.metadata.name)"] | length == 0
	' "$PODS" >/dev/null || { err "Stray or foreign Sandbox-owned Pods prevent suspension."; exit 1; }
}
