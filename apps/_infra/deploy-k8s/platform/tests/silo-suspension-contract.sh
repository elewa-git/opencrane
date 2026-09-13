#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
SUSPEND="$ROOT_DIR/apps/_infra/deploy-k8s/suspend.sh"
INVENTORY="$ROOT_DIR/apps/_infra/deploy-k8s/suspendible-test-silos.json"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-suspension-contract.XXXXXX")"
MOCK_BIN="$TEST_DIR/bin"
MOCK_STATE="$TEST_DIR/state"
mkdir -p "$MOCK_BIN" "$MOCK_STATE"
trap 'rm -rf -- "$TEST_DIR"' EXIT

jq -n --slurpfile inventory "$INVENTORY" '
	[$inventory[0].clusterTenants[] as $tenant |
		("opencrane-" + $tenant.name) as $release |
		{apiVersion:"apps/v1",kind:"Deployment",metadata:{namespace:$release,name:($release + "-opencrane-server"),resourceVersion:"1",labels:{"app.kubernetes.io/component":"opencrane-server"},annotations:{"meta.helm.sh/release-name":$release,"meta.helm.sh/release-namespace":$release}},spec:{replicas:1},status:{readyReplicas:1,availableReplicas:1}},
		{apiVersion:"apps/v1",kind:"Deployment",metadata:{namespace:($release + "-artifacts"),name:($release + "-artifact-service"),resourceVersion:"1",labels:{"app.kubernetes.io/component":"artifact-service"},annotations:{"meta.helm.sh/release-name":$release,"meta.helm.sh/release-namespace":$release}},spec:{replicas:1},status:{readyReplicas:1,availableReplicas:1}}] +
	[$inventory[0].sharedDeployments[] |
		{apiVersion:"apps/v1",kind:"Deployment",metadata:{namespace:.namespace,name:.name,uid:.uid,resourceVersion:"1",labels:.matchLabels,annotations:(if .helmRelease then {"meta.helm.sh/release-name":.helmRelease,"meta.helm.sh/release-namespace":.namespace} else {} end)},spec:{replicas:1,selector:{matchLabels:.selectorLabels},template:{spec:{containers:[{image:(.image // "registry.invalid/shared@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}]}}},status:{readyReplicas:1,availableReplicas:1}}] +
	[$inventory[0].externalDeployments[] |
		{apiVersion:"apps/v1",kind:"Deployment",metadata:{namespace:.namespace,name:.name,uid:.uid,resourceVersion:"1",labels:.matchLabels,annotations:.matchAnnotations},spec:{replicas:1,selector:{matchLabels:.selectorLabels},template:{spec:{containers:[.images[] | {image:.}]}}},status:{readyReplicas:1,availableReplicas:1}}] +
	[{apiVersion:"apps/v1",kind:"StatefulSet",metadata:{namespace:"opencrane-testv5",name:"opencrane-testv5-kurrentdb",resourceVersion:"1",annotations:{"meta.helm.sh/release-name":"opencrane-testv5","meta.helm.sh/release-namespace":"opencrane-testv5"}},spec:{replicas:1},status:{readyReplicas:1}},
	  {apiVersion:"batch/v1",kind:"CronJob",metadata:{namespace:"opencrane-testv5",name:"opencrane-testv5-kurrentdb-backup",resourceVersion:"1",annotations:{"meta.helm.sh/release-name":"opencrane-testv5","meta.helm.sh/release-namespace":"opencrane-testv5"}},spec:{suspend:false}}] |
	{apiVersion:"v1",kind:"List",items:.}
' >"$TEST_DIR/controllers.json"

jq -n --slurpfile inventory "$INVENTORY" '
	[$inventory[0].clusterTenants[] | ("opencrane-" + .name) as $namespace | ($namespace + "-postgres") as $release |
		{apiVersion:"postgresql.cnpg.io/v1",kind:"Cluster",metadata:{namespace:$namespace,name:$release,resourceVersion:"1",labels:{"app.kubernetes.io/instance":$release,"app.kubernetes.io/managed-by":"Helm"},annotations:{"meta.helm.sh/release-name":$release,"meta.helm.sh/release-namespace":$namespace}},spec:{instances:1},status:{readyInstances:1}},
		{apiVersion:"postgresql.cnpg.io/v1",kind:"Pooler",metadata:{namespace:$namespace,name:($release + "-pooler"),resourceVersion:"1",labels:{"app.kubernetes.io/instance":$release,"app.kubernetes.io/managed-by":"Helm"},annotations:{"meta.helm.sh/release-name":$release,"meta.helm.sh/release-namespace":$namespace}},spec:{instances:1},status:{instances:1,readyInstances:1}}] |
	{apiVersion:"v1",kind:"List",items:.}
' >"$TEST_DIR/cnpg.json"

jq -n --slurpfile inventory "$INVENTORY" '
	{apiVersion:"v1",kind:"List",items:[$inventory[0].clusterTenants[] | ("opencrane-" + .name) as $namespace | {apiVersion:"networking.k8s.io/v1",kind:"Ingress",metadata:{namespace:$namespace,name:($namespace + "-ingress"),annotations:{"meta.helm.sh/release-name":$namespace,"meta.helm.sh/release-namespace":$namespace}}}]}
' >"$TEST_DIR/ingresses.json"
printf '%s\n' '{"apiVersion":"v1","kind":"List","items":[]}' >"$TEST_DIR/empty.json"
jq -n '{apiVersion:"v1",kind:"List",items:[range(0;2) | {apiVersion:"extensions.agents.x-k8s.io/v1beta1",kind:"SandboxClaim",metadata:{namespace:"opencrane-testv5",name:("claim-" + tostring),uid:("claim-uid-" + tostring),resourceVersion:("claim-rv-" + tostring),labels:{"opencrane.ai/silo-id":"testv5"}},spec:{lifecycle:{shutdownPolicy:"DeleteForeground",shutdownTime:"2026-09-13T19:17:26Z"}},status:{sandbox:{name:("sandbox-" + tostring)}}}]}' >"$TEST_DIR/sandbox-claims.json"
jq -n '{apiVersion:"v1",kind:"List",items:[range(0;2) | {apiVersion:"agents.x-k8s.io/v1beta1",kind:"Sandbox",metadata:{namespace:"opencrane-testv5",name:("sandbox-" + tostring),uid:("sandbox-uid-" + tostring),resourceVersion:("sandbox-rv-" + tostring),ownerReferences:[{controller:true,kind:"SandboxClaim",name:("claim-" + tostring),uid:("claim-uid-" + tostring)}]},spec:{operatingMode:"Running",podTemplate:{spec:{volumes:[]}},volumeClaimTemplates:[]}}]}' >"$TEST_DIR/sandboxes.json"
jq -n '{apiVersion:"v1",kind:"List",items:[range(0;2) | {apiVersion:"v1",kind:"Pod",metadata:{namespace:"opencrane-testv5",name:("sandbox-" + tostring),uid:("pod-uid-" + tostring),ownerReferences:[{controller:true,kind:"Sandbox",name:("sandbox-" + tostring),uid:("sandbox-uid-" + tostring)}]},spec:{terminationGracePeriodSeconds:0,volumes:[]},status:{phase:"Running"}}]}' >"$TEST_DIR/sandbox-pods.json"

cat >"$MOCK_BIN/command-mock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
command_name="$(basename "$0")"
arguments="$*"
printf '%s %s\n' "$command_name" "$arguments" >>"$MOCK_CALLS"
case "$command_name" in
	helm)
		namespace=""; filter=""
		while [[ $# -gt 0 ]]; do
			case "$1" in --namespace) namespace="$2"; shift 2 ;; --filter) filter="$2"; shift 2 ;; *) shift ;; esac
		done
		release="${filter#^}"; release="${release%$}"
		tenant="${namespace#opencrane-}"
		if [[ "$release" == "$namespace" ]]; then
			chart="$(jq -r --arg tenant "$tenant" '.clusterTenants[] | select(.name == $tenant) | .mainChart' "$MOCK_INVENTORY")"
		else
			chart="$(jq -r --arg tenant "$tenant" '.clusterTenants[] | select(.name == $tenant) | .postgresChart' "$MOCK_INVENTORY")"
		fi
		[[ "${MOCK_FOREIGN_CHART:-0}" == "0" || "$tenant" != "testv3" ]] || chart="foreign-1.0.0"
		jq -cn --arg release "$release" --arg chart "$chart" '[{name:$release,chart:$chart}]'
		;;
	kubectl)
		if [[ "$*" == "config current-context" ]]; then printf '%s\n' "${MOCK_CONTEXT:-gke_weownai-proto_europe-west1_opencrane-dev}"; exit 0; fi
		if [[ "$*" == *" get namespaces -o json"* ]]; then
			jq -n --slurpfile inventory "$MOCK_INVENTORY" '{items:[$inventory[0].clusterTenants[] | ("opencrane-" + .name) as $namespace | {metadata:{name:$namespace}},{metadata:{name:($namespace + "-artifacts")}}]}'
			exit 0
		fi
		if [[ "$*" == *" get deployments.apps,statefulsets.apps,daemonsets.apps,cronjobs.batch,jobs.batch "* ]]; then
			if [[ "${MOCK_FOREIGN_CONTROLLER:-0}" == "1" ]]; then
				jq '.items += [{apiVersion:"apps/v1",kind:"Deployment",metadata:{namespace:"opencrane-testv4",name:"foreign",annotations:{}},spec:{replicas:1}}]' "$MOCK_FIXTURES/controllers.json"
			elif [[ "${MOCK_ACTIVE_JOB:-0}" == "1" ]]; then
				jq '.items += [{apiVersion:"batch/v1",kind:"Job",metadata:{namespace:"opencrane-testv4",name:"active",annotations:{"meta.helm.sh/release-name":"opencrane-testv4","meta.helm.sh/release-namespace":"opencrane-testv4"}},status:{active:1}}]' "$MOCK_FIXTURES/controllers.json"
			elif [[ "${MOCK_FAILED_JOB:-0}" == "1" ]]; then
				jq '.items += [{apiVersion:"batch/v1",kind:"Job",metadata:{namespace:"opencrane-testv4-artifacts",name:"retained-failure",annotations:{}},status:{active:0,failed:1}}]' "$MOCK_FIXTURES/controllers.json"
			else cat "$MOCK_FIXTURES/controllers.json"; fi
			exit 0
		fi
		if [[ "$*" == *" get clusters.postgresql.cnpg.io,poolers.postgresql.cnpg.io,scheduledbackups.postgresql.cnpg.io "* ]]; then cat "$MOCK_FIXTURES/cnpg.json"; exit 0; fi
		if [[ "$*" == *" get sandboxclaims.extensions.agents.x-k8s.io "* ]]; then cat "$MOCK_FIXTURES/sandbox-claims.json"; exit 0; fi
		if [[ "$*" == *" get sandboxes.agents.x-k8s.io "* ]]; then
			jq --argjson suspended0 "$(if [[ -e "$MOCK_STATE/sandboxes.agents.x-k8s.io-opencrane-testv5-sandbox-0" ]]; then echo true; else echo false; fi)" \
				--argjson suspended1 "$(if [[ -e "$MOCK_STATE/sandboxes.agents.x-k8s.io-opencrane-testv5-sandbox-1" ]]; then echo true; else echo false; fi)" \
				--argjson durableTemplate "${MOCK_SANDBOX_VOLUME_TEMPLATE:-0}" \
				--argjson durableVolume "${MOCK_SANDBOX_TEMPLATE_VOLUME:-0}" \
				--argjson wrongOwner "${MOCK_WRONG_SANDBOX_OWNER:-0}" \
				--argjson duplicate "${MOCK_DUPLICATE_SANDBOX:-0}" '
				if $suspended0 then .items[0].spec.operatingMode="Suspended" else . end |
				if $suspended1 then .items[1].spec.operatingMode="Suspended" else . end |
				if $durableTemplate == 1 then .items[0].spec.volumeClaimTemplates=[{metadata:{name:"durable"},spec:{}}] else . end |
				if $durableVolume == 1 then .items[0].spec.podTemplate.spec.volumes=[{name:"durable",persistentVolumeClaim:{claimName:"durable"}}] else . end |
				if $wrongOwner == 1 then .items[0].metadata.ownerReferences[0].uid="foreign-claim-uid" else . end |
				if $duplicate == 1 then .items += [.items[0]] else . end
			' "$MOCK_FIXTURES/sandboxes.json"
			exit 0
		fi
		if [[ "$*" == *" get pods --all-namespaces "* ]]; then
			if [[ "${MOCK_STANDALONE_POD:-0}" == "1" ]]; then
				jq -n '{items:[{apiVersion:"v1",kind:"Pod",metadata:{namespace:"opencrane-testv4-artifacts",name:"unowned"},status:{phase:"Running"}}]}'
			else
				jq --argjson absent0 "$(if [[ "${MOCK_PARTIAL_POD_ABSENCE:-0}" == "1" || "${MOCK_ALL_PODS_ABSENT:-0}" == "1" || -e "$MOCK_STATE/pod-opencrane-testv5-sandbox-0" ]]; then echo true; else echo false; fi)" \
					--argjson absent1 "$(if [[ "${MOCK_ALL_PODS_ABSENT:-0}" == "1" || -e "$MOCK_STATE/pod-opencrane-testv5-sandbox-1" ]]; then echo true; else echo false; fi)" \
					--argjson durable "${MOCK_SANDBOX_PVC:-0}" \
					--argjson wrongOwner "${MOCK_WRONG_POD_OWNER:-0}" \
					--argjson stray "${MOCK_STRAY_SANDBOX_POD:-0}" \
					--argjson duplicate "${MOCK_DUPLICATE_SANDBOX_POD:-0}" '
					.items |= map(select((.metadata.name != "sandbox-0" or ($absent0 | not)) and (.metadata.name != "sandbox-1" or ($absent1 | not)))) |
					if $durable == 1 and ([.items[] | select(.metadata.name == "sandbox-0")] | length) == 1 then
						(.items[] | select(.metadata.name == "sandbox-0")).spec.volumes=[{persistentVolumeClaim:{claimName:"durable"}}]
					else . end |
					if $wrongOwner == 1 then (.items[] | select(.metadata.name == "sandbox-0")).metadata.ownerReferences[0].uid="foreign-sandbox-uid" else . end |
					if $stray == 1 then .items += [{apiVersion:"v1",kind:"Pod",metadata:{namespace:"opencrane-testv5",name:"stray-sandbox-pod",uid:"stray-pod-uid",ownerReferences:[{controller:true,kind:"Sandbox",name:"missing-sandbox",uid:"missing-sandbox-uid"}]},spec:{terminationGracePeriodSeconds:0,volumes:[]},status:{phase:"Running"}}] else . end |
					if $duplicate == 1 then .items += [.items[0]] else . end
				' "$MOCK_FIXTURES/sandbox-pods.json"
			fi
			exit 0
		fi
		if [[ "$*" == *" get ingresses.networking.k8s.io "* ]]; then cat "$MOCK_FIXTURES/ingresses.json"; exit 0; fi
		if [[ "$*" == *" get namespace/opencrane-"* ]]; then name="${arguments#* get }"; name="${name%% *}"; printf '%s\n' "$name"; exit 0; fi
		if [[ "$*" == *" get pvc --all-namespaces "* ]]; then
			jq -n --argjson drift "${MOCK_STORAGE_DRIFT:-0}" --slurpfile inventory "$MOCK_INVENTORY" '{items:[$inventory[0].clusterTenants[] | ("opencrane-" + .name) as $namespace | (if .name == "testv5" then [{n:"postgres",s:20},{n:"cognee",s:10},{n:"kurrent",s:20},{n:"backup",s:60},{n:"artifact",s:20}] else [{n:"postgres",s:20},{n:"cognee",s:10},{n:"artifact",s:20}] end)[] | select(($drift == 0) or $namespace != "opencrane-testv3" or .n != "artifact") | (.n == "artifact") as $artifact | {metadata:{namespace:(if $artifact then $namespace + "-artifacts" else $namespace end),name:("pvc-" + .n),uid:("uid-" + $namespace + "-" + .n)},spec:{volumeName:("pv-" + $namespace + "-" + .n)},status:{capacity:{storage:((.s | tostring) + "Gi")}}}]}'
			exit 0
		fi
		if [[ "$*" == *" get pv -o json"* ]]; then
			jq -n --slurpfile inventory "$MOCK_INVENTORY" '{items:[$inventory[0].clusterTenants[] | ("opencrane-" + .name) as $namespace | (if .name == "testv5" then [{n:"postgres",s:20},{n:"cognee",s:10},{n:"kurrent",s:20},{n:"backup",s:60},{n:"artifact",s:20}] else [{n:"postgres",s:20},{n:"cognee",s:10},{n:"artifact",s:20}] end)[] | (.n == "artifact") as $artifact | {metadata:{name:("pv-" + $namespace + "-" + .n),uid:("pvuid-" + $namespace + "-" + .n)},spec:{claimRef:{namespace:(if $artifact then $namespace + "-artifacts" else $namespace end),name:("pvc-" + .n),uid:("uid-" + $namespace + "-" + .n)},csi:{volumeHandle:("handle-" + $namespace + "-" + .n)},capacity:{storage:((.s | tostring) + "Gi")}}}]}'
			exit 0
		fi
		if [[ "$*" == *" get secrets --all-namespaces "* ]]; then
			printf 'opencrane-testv5-artifacts\tlarge-retained-secret\tsecret-uid\n'
			exit 0
		fi
		if [[ "$*" == *" get volumesnapshots."* || "$*" == *" get volumesnapshotcontents."* ]]; then cat "$MOCK_FIXTURES/empty.json"; exit 0; fi
		if [[ "$*" == *" get deployment/"* ]]; then
			resource="${arguments#* get deployment/}"; name="${resource%% *}"; namespace="${arguments#*--namespace }"; namespace="${namespace%% *}"
			jq --arg namespace "$namespace" --arg name "$name" '.items[] | select(.kind == "Deployment" and .metadata.namespace == $namespace and .metadata.name == $name)' "$MOCK_FIXTURES/controllers.json" |
				jq 'if $drift == 1 and .metadata.name == "ingress-nginx-controller" then .metadata.uid="drifted" else . end | if $stopped then .spec.replicas=0 | .status.readyReplicas=0 | .status.availableReplicas=0 else . end' --argjson drift "${MOCK_SHARED_DRIFT:-0}" --argjson stopped "$(if [[ -e "$MOCK_STATE/deployment-$namespace-$name" ]]; then echo true; else echo false; fi)"
			exit 0
		fi
		if [[ "$*" == *" get sandboxclaims.extensions.agents.x-k8s.io/"* ]]; then
			resource="${arguments#* get sandboxclaims.extensions.agents.x-k8s.io/}"; name="${resource%% *}"
			jq --arg name "$name" --argjson substitute "$(if [[ "${MOCK_SUBSTITUTED_CLAIM_UID:-0}" == "1" && -e "$MOCK_STATE/deployment-agent-sandbox-system-agent-sandbox-controller" ]]; then echo true; else echo false; fi)" '
				.items[] | select(.metadata.name == $name) | if $substitute then .metadata.uid="substituted-claim-uid" else . end
			' "$MOCK_FIXTURES/sandbox-claims.json"
			exit 0
		fi
		if [[ "$*" == *" get sandboxes.agents.x-k8s.io/"* ]]; then
			resource="${arguments#* get sandboxes.agents.x-k8s.io/}"; name="${resource%% *}"
			jq --arg name "$name" \
				--argjson suspended "$(if [[ -e "$MOCK_STATE/sandboxes.agents.x-k8s.io-opencrane-testv5-$name" ]]; then echo true; else echo false; fi)" \
				--argjson substitute "$(if [[ "${MOCK_SUBSTITUTED_SANDBOX_UID:-0}" == "1" && -e "$MOCK_STATE/deployment-agent-sandbox-system-agent-sandbox-controller" ]]; then echo true; else echo false; fi)" '
				.items[] | select(.metadata.name == $name) |
				if $suspended then .spec.operatingMode="Suspended" | .metadata.resourceVersion=(.metadata.resourceVersion + "-patched") else . end |
				if $substitute then .metadata.uid="substituted-sandbox-uid" else . end
			' "$MOCK_FIXTURES/sandboxes.json"
			exit 0
		fi
		if [[ "$*" == *" get pod/"* ]]; then
			resource="${arguments#* get pod/}"; name="${resource%% *}"
			if [[ "${MOCK_ALL_PODS_ABSENT:-0}" == "1" || ("${MOCK_PARTIAL_POD_ABSENCE:-0}" == "1" && "$name" == "sandbox-0") || -e "$MOCK_STATE/pod-opencrane-testv5-$name" ]]; then exit 0; fi
			jq --arg name "$name" '.items[] | select(.metadata.name == $name)' "$MOCK_FIXTURES/sandbox-pods.json"
			exit 0
		fi
		if [[ "$*" == *" get statefulset/"* ]]; then
			resource="${arguments#* get statefulset/}"; name="${resource%% *}"
			jq --arg name "$name" --argjson stopped "$(if [[ -e "$MOCK_STATE/statefulset-opencrane-testv5-$name" ]]; then echo true; else echo false; fi)" '.items[] | select(.kind == "StatefulSet" and .metadata.name == $name) | if $stopped then .spec.replicas=0 else . end' "$MOCK_FIXTURES/controllers.json"
			exit 0
		fi
		if [[ "$*" == *" get cronjob/"* ]]; then jq '.items[] | select(.kind == "CronJob")' "$MOCK_FIXTURES/controllers.json"; exit 0; fi
		if [[ "$*" == *" get pooler/"* ]]; then
			resource="${arguments#* get pooler/}"; name="${resource%% *}"; namespace="${arguments#*--namespace }"; namespace="${namespace%% *}"
			jq --arg namespace "$namespace" --arg name "$name" '.items[] | select(.kind == "Pooler" and .metadata.namespace == $namespace and .metadata.name == $name)' "$MOCK_FIXTURES/cnpg.json" | jq 'if $stopped then .spec.instances=0 | .status.instances=0 | .status.readyInstances=0 | .metadata.annotations["opencrane.ai/suspend-original-pooler-instances"]="1" | .metadata.annotations["opencrane.ai/suspended-by"]="opencrane-test-silo-suspension-v1" else . end' --argjson stopped "$(if [[ -e "$MOCK_STATE/pooler-$namespace-$name" ]]; then echo true; else echo false; fi)"
			exit 0
		fi
		if [[ "$*" == *" get cluster/"* ]]; then
			resource="${arguments#* get cluster/}"; name="${resource%% *}"; namespace="${arguments#*--namespace }"; namespace="${namespace%% *}"
			jq --arg namespace "$namespace" --arg name "$name" '.items[] | select(.kind == "Cluster" and .metadata.namespace == $namespace and .metadata.name == $name)' "$MOCK_FIXTURES/cnpg.json" | jq 'if $stopped then .metadata.annotations["cnpg.io/hibernation"]="on" | .status.readyInstances=0 | .status.conditions=[{type:"cnpg.io/hibernation",status:"True"}] else . end' --argjson stopped "$(if [[ -e "$MOCK_STATE/cluster-$namespace-$name" ]]; then echo true; else echo false; fi)"
			exit 0
		fi
		if [[ "$*" == *" patch "* ]]; then
			resource="${arguments#* patch }"; resource="${resource%% *}"; namespace="${arguments#*--namespace }"; namespace="${namespace%% *}"
			kind="${resource%%/*}"; name="${resource#*/}"
			if [[ "$kind" == "sandboxes.agents.x-k8s.io" ]]; then
				payload="${arguments#* -p }"
				index="${name#sandbox-}"
				expected_rv="sandbox-rv-$index"
				[[ ! -e "$MOCK_STATE/$kind-$namespace-$name" ]] || expected_rv="${expected_rv}-patched"
				jq -e --arg uid "sandbox-uid-$index" --arg rv "$expected_rv" '
					.[0] == {op:"test",path:"/metadata/uid",value:$uid} and
					.[1] == {op:"test",path:"/metadata/resourceVersion",value:$rv} and
					.[2] == {op:"add",path:"/spec/operatingMode",value:"Suspended"}
				' <<<"$payload" >/dev/null
			fi
			touch "$MOCK_STATE/$kind-$namespace-$name"; printf '{}\n'; exit 0
		fi
		if [[ "$*" == *" delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-"* ]]; then
			payload="$(cat)"
			jq -e '.apiVersion == "v1" and .kind == "DeleteOptions" and .gracePeriodSeconds == 0 and .propagationPolicy == "Background" and (.preconditions.uid | test("^pod-uid-[01]$"))' <<<"$payload" >/dev/null
			pod_path="${arguments#* /api/v1/namespaces/}"; namespace="${pod_path%%/*}"; name="${pod_path##*/}"; name="${name%% *}"
			touch "$MOCK_STATE/pod-$namespace-$name"
			printf '{}\n'
			exit 0
		fi
		printf 'Unhandled kubectl call: %s\n' "$*" >&2; exit 1
		;;
	date)
		counter="$MOCK_STATE/date-counter"; value=100
		if [[ -e "$counter" ]]; then value=$(( $(cat "$counter") + 10 )); fi
		printf '%s\n' "$value" >"$counter"
		printf '%s\n' "$value"
		;;
	sleep) exit 0 ;;
esac
MOCK
chmod +x "$MOCK_BIN/command-mock"
for command_name in helm kubectl date sleep; do ln -s "$MOCK_BIN/command-mock" "$MOCK_BIN/$command_name"; done

run_case()
{
	local name="$1" mode="$2"; shift 2
	local args=()
	[[ "$mode" != "preflight" ]] || args+=(--preflight)
	rm -rf "$MOCK_STATE"; mkdir -p "$MOCK_STATE"
	env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/$name.calls" MOCK_FIXTURES="$TEST_DIR" MOCK_STATE="$MOCK_STATE" MOCK_INVENTORY="$INVENTORY" "$@" \
		bash "$SUSPEND" --context gke_weownai-proto_europe-west1_opencrane-dev \
		--confirm-suspend suspend-all-opencrane-dev-test-silos --settle-timeout-seconds 1 \
		${args[@]+"${args[@]}"} >"$TEST_DIR/$name.log" 2>&1
}

run_preserved_case()
{
	local name="$1"
	env PATH="$MOCK_BIN:$PATH" MOCK_CALLS="$TEST_DIR/$name.calls" MOCK_FIXTURES="$TEST_DIR" MOCK_STATE="$MOCK_STATE" MOCK_INVENTORY="$INVENTORY" \
		bash "$SUSPEND" --context gke_weownai-proto_europe-west1_opencrane-dev \
		--confirm-suspend suspend-all-opencrane-dev-test-silos --settle-timeout-seconds 1 >"$TEST_DIR/$name.log" 2>&1
}

if run_case wrong-context preflight MOCK_CONTEXT=other; then echo 'wrong context unexpectedly passed' >&2; exit 1; fi
[[ ! -f "$TEST_DIR/wrong-context.calls" ]] || ! grep -Eq ' patch | delete ' "$TEST_DIR/wrong-context.calls"

if run_case foreign-chart preflight MOCK_FOREIGN_CHART=1; then echo 'foreign chart unexpectedly passed' >&2; exit 1; fi
[[ ! -f "$TEST_DIR/foreign-chart.calls" ]] || ! grep -Eq ' patch | delete ' "$TEST_DIR/foreign-chart.calls"

if run_case foreign-controller preflight MOCK_FOREIGN_CONTROLLER=1; then echo 'foreign controller unexpectedly passed' >&2; exit 1; fi
[[ ! -f "$TEST_DIR/foreign-controller.calls" ]] || ! grep -Eq ' patch | delete ' "$TEST_DIR/foreign-controller.calls"

if run_case standalone-pod preflight MOCK_STANDALONE_POD=1; then echo 'standalone active Pod unexpectedly passed' >&2; exit 1; fi
grep -Fq 'Standalone or ambiguously owned active Pods prevent suspension' "$TEST_DIR/standalone-pod.log" || { cat "$TEST_DIR/standalone-pod.log" >&2; exit 1; }
! grep -Eq ' patch | delete ' "$TEST_DIR/standalone-pod.calls"

if run_case durable-sandbox-pod preflight MOCK_SANDBOX_PVC=1; then echo 'PVC-backed Sandbox Pod unexpectedly passed' >&2; exit 1; fi
grep -Fq "Sandbox Pod 'opencrane-testv5/sandbox-0' is not disposable" "$TEST_DIR/durable-sandbox-pod.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/durable-sandbox-pod.calls"

if run_case durable-sandbox-template preflight MOCK_ALL_PODS_ABSENT=1 MOCK_SANDBOX_VOLUME_TEMPLATE=1; then echo 'PVC-templated Sandbox unexpectedly passed' >&2; exit 1; fi
grep -Fq "Sandbox 'opencrane-testv5/sandbox-0' has durable volume configuration" "$TEST_DIR/durable-sandbox-template.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/durable-sandbox-template.calls"

if run_case durable-sandbox-volume preflight MOCK_ALL_PODS_ABSENT=1 MOCK_SANDBOX_TEMPLATE_VOLUME=1; then echo 'PVC-volume Sandbox unexpectedly passed' >&2; exit 1; fi
grep -Fq "Sandbox 'opencrane-testv5/sandbox-0' has durable volume configuration" "$TEST_DIR/durable-sandbox-volume.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/durable-sandbox-volume.calls"

if run_case wrong-sandbox-owner preflight MOCK_WRONG_SANDBOX_OWNER=1; then echo 'wrong Sandbox owner unexpectedly passed' >&2; exit 1; fi
grep -Fq "Sandbox owner chain is invalid for 'claim-0'" "$TEST_DIR/wrong-sandbox-owner.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/wrong-sandbox-owner.calls"

if run_case wrong-pod-owner preflight MOCK_WRONG_POD_OWNER=1; then echo 'wrong Sandbox Pod owner unexpectedly passed' >&2; exit 1; fi
grep -Fq "Sandbox Pod 'opencrane-testv5/sandbox-0' is not disposable or has an invalid owner" "$TEST_DIR/wrong-pod-owner.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/wrong-pod-owner.calls"

if run_case stray-sandbox-pod preflight MOCK_STRAY_SANDBOX_POD=1; then echo 'stray Sandbox Pod unexpectedly passed' >&2; exit 1; fi
grep -Fq 'Stray or foreign Sandbox-owned Pods prevent suspension' "$TEST_DIR/stray-sandbox-pod.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/stray-sandbox-pod.calls"

if run_case duplicate-sandbox preflight MOCK_DUPLICATE_SANDBOX=1; then echo 'duplicate Sandbox unexpectedly passed' >&2; exit 1; fi
grep -Fq 'Sandbox count does not match the retained Claim count' "$TEST_DIR/duplicate-sandbox.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/duplicate-sandbox.calls"

if run_case duplicate-sandbox-pod preflight MOCK_DUPLICATE_SANDBOX_POD=1; then echo 'duplicate Sandbox Pod unexpectedly passed' >&2; exit 1; fi
grep -Fq "Duplicate Sandbox Pods exist for 'opencrane-testv5/sandbox-0'" "$TEST_DIR/duplicate-sandbox-pod.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/duplicate-sandbox-pod.calls"

if run_case shared-drift preflight MOCK_SHARED_DRIFT=1; then echo 'shared controller drift unexpectedly passed' >&2; exit 1; fi
grep -Fq 'identity or ownership markers drifted' "$TEST_DIR/shared-drift.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/shared-drift.calls"

if run_case storage-drift preflight MOCK_STORAGE_DRIFT=1; then echo 'retained storage drift unexpectedly passed' >&2; exit 1; fi
grep -Fq "Retained storage mismatch for 'testv3'" "$TEST_DIR/storage-drift.log"
! grep -Eq ' patch | delete ' "$TEST_DIR/storage-drift.calls"

if ! run_case failed-job preflight MOCK_FAILED_JOB=1; then cat "$TEST_DIR/failed-job.log" >&2; exit 1; fi
! grep -Eq ' patch | delete ' "$TEST_DIR/failed-job.calls"

if run_case active-job execute MOCK_ACTIVE_JOB=1; then echo 'active Job unexpectedly passed' >&2; exit 1; fi
if ! grep -Fq 'Active Jobs did not settle' "$TEST_DIR/active-job.log"; then cat "$TEST_DIR/active-job.log" >&2; cat "$TEST_DIR/active-job.calls" >&2; exit 1; fi
! grep -Eq ' delete (namespace|pvc|pv|secret|volumesnapshot|volumesnapshotcontent|clusterrole|clusterrolebinding)' "$TEST_DIR/active-job.calls"

if ! run_case preflight preflight; then cat "$TEST_DIR/preflight.log" >&2; exit 1; fi
! grep -Eq ' patch | delete ' "$TEST_DIR/preflight.calls"

if run_case substituted-claim execute MOCK_SUBSTITUTED_CLAIM_UID=1; then echo 'substituted SandboxClaim UID unexpectedly passed' >&2; exit 1; fi
grep -Fq 'SandboxClaim/opencrane-testv5/claim-0 identity or Sandbox assignment changed during suspension' "$TEST_DIR/substituted-claim.log"
! grep -Eq 'patch sandboxes.agents.x-k8s.io|delete --raw .*pods/sandbox-' "$TEST_DIR/substituted-claim.calls"

if run_case substituted-sandbox execute MOCK_SUBSTITUTED_SANDBOX_UID=1; then echo 'substituted Sandbox UID unexpectedly passed' >&2; exit 1; fi
grep -Fq 'Sandbox/opencrane-testv5/sandbox-0 identity, Claim ownership or durable volume contract changed during suspension' "$TEST_DIR/substituted-sandbox.log"
! grep -Eq 'patch sandboxes.agents.x-k8s.io|delete --raw .*pods/sandbox-' "$TEST_DIR/substituted-sandbox.calls"

if ! run_case partial-pod-absence execute MOCK_PARTIAL_POD_ABSENCE=1; then cat "$TEST_DIR/partial-pod-absence.log" >&2; cat "$TEST_DIR/partial-pod-absence.calls" >&2; exit 1; fi
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-0 --namespace opencrane-testv5 --type=json' "$TEST_DIR/partial-pod-absence.calls"
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-1 --namespace opencrane-testv5 --type=json' "$TEST_DIR/partial-pod-absence.calls"
! grep -Fq 'delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-0' "$TEST_DIR/partial-pod-absence.calls"
grep -Fq 'delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-1' "$TEST_DIR/partial-pod-absence.calls"

if ! run_case success execute; then cat "$TEST_DIR/success.log" >&2; cat "$TEST_DIR/success.calls" >&2; exit 1; fi
grep -Fq 'Suspended six OpenCrane development test silos' "$TEST_DIR/success.log"
grep -Fq 'patch cronjob/opencrane-testv5-kurrentdb-backup' "$TEST_DIR/success.calls"
grep -Fq 'patch pooler/opencrane-testv5-postgres-pooler' "$TEST_DIR/success.calls"
grep -Fq 'patch cluster/opencrane-testv5-postgres' "$TEST_DIR/success.calls"
grep -Fq 'patch deployment/cloudnative-pg' "$TEST_DIR/success.calls"
grep -Fq 'patch deployment/ingress-nginx-controller' "$TEST_DIR/success.calls"
grep -Fq 'patch deployment/sms1obot-mcp-server --namespace opencrane-d2latency-0823' "$TEST_DIR/success.calls"
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-0 --namespace opencrane-testv5 --type=json' "$TEST_DIR/success.calls"
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-1 --namespace opencrane-testv5 --type=json' "$TEST_DIR/success.calls"
grep -Fq 'delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-0 -f -' "$TEST_DIR/success.calls"
grep -Fq 'delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-1 -f -' "$TEST_DIR/success.calls"
! grep -Eq 'patch sandboxclaims|delete .*sandbox(claim)?s' "$TEST_DIR/success.calls"
! grep -Eq ' (patch|delete) (lease|leases|lease.coordination.k8s.io|leases.coordination.k8s.io)' "$TEST_DIR/success.calls"
! grep -Eq ' delete (namespace|pvc|pv|secret|volumesnapshot|volumesnapshotcontent|clusterrole|clusterrolebinding)' "$TEST_DIR/success.calls"
! grep -Eq -- '--argjson (pvc|pv|secrets|snapshots|contents)' "$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-suspend-inventory.sh"

if ! run_preserved_case complete-rerun; then cat "$TEST_DIR/complete-rerun.log" >&2; cat "$TEST_DIR/complete-rerun.calls" >&2; exit 1; fi
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-0 --namespace opencrane-testv5 --type=json' "$TEST_DIR/complete-rerun.calls"
grep -Fq 'patch sandboxes.agents.x-k8s.io/sandbox-1 --namespace opencrane-testv5 --type=json' "$TEST_DIR/complete-rerun.calls"
! grep -Fq 'delete --raw /api/v1/namespaces/opencrane-testv5/pods/sandbox-' "$TEST_DIR/complete-rerun.calls"
! grep -Eq 'patch sandboxclaims|delete .*sandbox(claim)?s' "$TEST_DIR/complete-rerun.calls"
! grep -Eq ' (patch|delete) (lease|leases|lease.coordination.k8s.io|leases.coordination.k8s.io)' "$TEST_DIR/complete-rerun.calls"

printf 'silo suspension contract: PASS\n'
