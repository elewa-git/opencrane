#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
source "$ROOT/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ARTIFACT_CONFORMANCE="$ROOT/apps/agent-controller/tests/artifact-admission-conformance.sh"
IDENTITY_CONFORMANCE="$ROOT/apps/agent-controller/tests/identity-conformance.sh"
WARM_POLICY_ASSERTIONS="$ROOT/apps/agent-controller/tests/warm-runtime-network-policy-assertions.mjs"
MANIFEST="$(mktemp)"
DISABLED="$(mktemp)"
ARTIFACT_DISABLED="$(mktemp)"
ARTIFACT_ROLE="$(mktemp)"
ARTIFACT_BINDING="$(mktemp)"
ARTIFACT_ADMISSION="$(mktemp)"
ARTIFACT_ADMISSION_BINDING="$(mktemp)"
RUNTIME_NAMESPACE="$(mktemp)"
MANAGED_RUNTIME_NAMESPACE="$(mktemp)"
RUNTIME_QUOTA="$(mktemp)"
MANAGED_RUNTIME_QUOTA="$(mktemp)"
ADMISSION="$(mktemp)"
SKILL_URL_OVERRIDE="$(mktemp)"
SERVER_POLICY="$(mktemp)"
CONTROLLER_POLICY="$(mktemp)"
prepare_current_chart_sources
trap 'cleanup_current_chart_sources; rm -f "$MANIFEST" "$DISABLED" "$ARTIFACT_DISABLED" "$ARTIFACT_ROLE" "$ARTIFACT_BINDING" "$ARTIFACT_ADMISSION" "$ARTIFACT_ADMISSION_BINDING" "$RUNTIME_NAMESPACE" "$MANAGED_RUNTIME_NAMESPACE" "$RUNTIME_QUOTA" "$MANAGED_RUNTIME_QUOTA" "$ADMISSION" "$SKILL_URL_OVERRIDE" "$SERVER_POLICY" "$CONTROLLER_POLICY"' EXIT
CHART_ROOT="$(current_chart_sources_dir)"

render_enabled() {
  helm template oc "$CHART_ROOT" \
    --namespace server-ns \
    --set agentController.enabled=true \
    --set-string clustertenantManager.database.existingSecret=opencrane-app-db \
    --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    --set-string agentController.warmRuntime.managedNamespace=oc-managed-warm-custom \
    --set-string agentController.skillAuthoringValidation.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    --set-string opencrane-mcp-executor.mcpExecutor.image.digest=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    --set artifactPreprocessor.enabled=true \
    --set-string artifactPreprocessor.image.digest=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
    --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    --set agentController.kubernetesApiServerEndpointPort=6443 \
    "$@"
}

render_enabled > "$MANIFEST"
render_enabled --set agentController.enabled=false > "$DISABLED"
render_enabled --set artifactPreprocessor.enabled=false > "$ARTIFACT_DISABLED"
render_enabled --set-string agentController.openCraneInternalUrl=http://override.example:8081 > "$SKILL_URL_OVERRIDE"

awk 'BEGIN { RS="---" } $0 ~ /\nkind: Role\n/ && $0 ~ /\n  name: agent-controller-artifact-preprocessor\n/ { print $0 }' "$MANIFEST" > "$ARTIFACT_ROLE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: RoleBinding\n/ && $0 ~ /\n  name: agent-controller-artifact-preprocessor\n/ { print $0 }' "$MANIFEST" > "$ARTIFACT_BINDING"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ValidatingAdmissionPolicy\n/ && $0 ~ /app.kubernetes.io\/component: artifact-preprocessor/ { print $0 }' "$MANIFEST" > "$ARTIFACT_ADMISSION"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ValidatingAdmissionPolicyBinding\n/ && $0 ~ /app.kubernetes.io\/component: artifact-preprocessor/ { print $0 }' "$MANIFEST" > "$ARTIFACT_ADMISSION_BINDING"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: Namespace\n/ && $0 ~ /\n  name: oc-opencrane-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_NAMESPACE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: Namespace\n/ && $0 ~ /\n  name: oc-managed-warm-custom\n/ { print $0 }' "$MANIFEST" > "$MANAGED_RUNTIME_NAMESPACE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ResourceQuota\n/ && $0 ~ /\n  name: oc-opencrane-warm-runtime\n/ && $0 ~ /\n  namespace: oc-opencrane-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_QUOTA"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ResourceQuota\n/ && $0 ~ /\n  name: oc-opencrane-warm-runtime\n/ && $0 ~ /\n  namespace: oc-managed-warm-custom\n/ { print $0 }' "$MANIFEST" > "$MANAGED_RUNTIME_QUOTA"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ValidatingAdmissionPolicy\n/ { print $0 }' "$MANIFEST" > "$ADMISSION"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-opencrane-server\n/ { print $0 }' "$MANIFEST" > "$SERVER_POLICY"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-agent-controller\n/ { print $0 }' "$MANIFEST" > "$CONTROLLER_POLICY"

# Two deterministic restricted namespaces own only the fixed warm pools.
test -s "$RUNTIME_NAMESPACE"
test -s "$MANAGED_RUNTIME_NAMESPACE"
grep -Fq 'opencrane.ai/runtime-release:' "$RUNTIME_NAMESPACE"
grep -Fq 'opencrane.ai/runtime-release:' "$MANAGED_RUNTIME_NAMESPACE"
grep -Fq 'pod-security.kubernetes.io/enforce: restricted' "$RUNTIME_NAMESPACE"
grep -Fq 'pod-security.kubernetes.io/enforce: restricted' "$MANAGED_RUNTIME_NAMESPACE"
grep -Fq 'pod-security.kubernetes.io/enforce-version: latest' "$RUNTIME_NAMESPACE"
grep -Fq 'name: warm-runtime' "$MANIFEST"
grep -A1 -F 'name: OPENCRANE_RUNTIME_STREAM_URL' "$MANIFEST" | grep -F '/api/internal/warm-runtime' >/dev/null
grep -Fq 'audience: opencrane-warm-runtime' "$MANIFEST"
grep -Fq 'path: warm.token' "$MANIFEST"
test -s "$RUNTIME_QUOTA"
test -s "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'pods: "6"' "$RUNTIME_QUOTA"
grep -Fq 'count/deployments.apps: "1"' "$RUNTIME_QUOTA"
grep -Fq 'count/deployments.apps: "1"' "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'requests.cpu: "2"' "$RUNTIME_QUOTA"
grep -Fq 'requests.memory: "4Gi"' "$RUNTIME_QUOTA"
grep -Fq 'limits.cpu: "20"' "$RUNTIME_QUOTA"
grep -Fq 'limits.memory: "20Gi"' "$RUNTIME_QUOTA"

# Warm AgentRuns leave no Job-create profile, Secret grant, or legacy runtime profile map.
if grep -Eq 'AGENT_CONTROLLER_PROFILES_JSON|managed-agent-runtime-default|agent-runtime-default' "$MANIFEST"; then
  echo "warm runtime render retained the old per-run Job profile" >&2
  exit 1
fi

# AgentRun cancellation is workflow-owned, so the OpenCrane server has no legacy Job cleanup Role.
if grep -Fq 'name: oc-opencrane-runtime-cleanup' "$MANIFEST"; then
  echo "legacy AgentRun Job cleanup RBAC remains in the enabled render" >&2
  exit 1
fi

# The governed skill namespace is derived from its owning chart. Its controller Role can create,
# exact-adopt, and conditionally release Jobs, plus list the exact Job-owned Pod for registration.
grep -A16 -F 'namespace: opencrane-skill-authoring' "$MANIFEST" | grep -F 'name: agent-controller-skill-authoring' >/dev/null
grep -A16 -F 'name: agent-controller-skill-authoring' "$MANIFEST" | grep -F 'verbs: ["get", "create", "patch"]' >/dev/null
grep -A16 -F 'name: agent-controller-skill-authoring' "$MANIFEST" | grep -F 'resources: ["pods"]' >/dev/null
grep -A16 -F 'name: agent-controller-skill-authoring' "$MANIFEST" | grep -F 'verbs: ["list"]' >/dev/null
if grep -A16 -F 'name: agent-controller-skill-authoring' "$MANIFEST" | grep -E '"(delete|update|watch)"' >/dev/null; then
  echo "skill-authoring Roles exceed fenced Job release and Pod discovery authority" >&2
  exit 1
fi

# OCI-backed MCP Jobs have the same create/register/release verbs in their own namespace, without
# Secret access or any broader workload mutation.
grep -A16 -F 'namespace: opencrane-mcp-executors' "$MANIFEST" | grep -F 'name: agent-controller-mcp-executor' >/dev/null
grep -A16 -F 'name: agent-controller-mcp-executor' "$MANIFEST" | grep -F 'resources: ["jobs"]' >/dev/null
grep -A16 -F 'name: agent-controller-mcp-executor' "$MANIFEST" | grep -F 'verbs: ["get", "create", "patch"]' >/dev/null
grep -A16 -F 'name: agent-controller-mcp-executor' "$MANIFEST" | grep -F 'resources: ["pods"]' >/dev/null
if grep -A16 -F 'name: agent-controller-mcp-executor' "$MANIFEST" | grep -Eq 'resources: \["secrets"\]|"(delete|update|watch)"' >/dev/null; then
  echo "MCP executor Role exceeds fenced Job release and Pod discovery authority" >&2
  exit 1
fi

# Artifact preprocessing is optional. When enabled, its isolated namespace grants only the shared
# governed store's suspended-Job release, exact-Pod discovery, and UID-fenced cleanup operations.
test -s "$ARTIFACT_ROLE"
grep -Fq 'namespace: oc-opencrane-artifact-preprocessing' "$ARTIFACT_ROLE"
grep -Fq 'resources: ["jobs"]' "$ARTIFACT_ROLE"
grep -Fq 'verbs: ["get", "create", "patch", "delete"]' "$ARTIFACT_ROLE"
grep -Fq 'resources: ["pods"]' "$ARTIFACT_ROLE"
grep -Fq 'verbs: ["list"]' "$ARTIFACT_ROLE"
if grep -Eq 'resources: \["secrets"\]|"(update|watch)"' "$ARTIFACT_ROLE"; then
  echo "artifact preprocessing Role exceeds fenced Job release, Pod discovery, and cleanup authority" >&2
  exit 1
fi
test -s "$ARTIFACT_BINDING"
grep -A4 -F 'kind: ServiceAccount' "$ARTIFACT_BINDING" | grep -F 'name: agent-controller' >/dev/null
grep -A4 -F 'kind: ServiceAccount' "$ARTIFACT_BINDING" | grep -F 'namespace: server-ns' >/dev/null
test -s "$ARTIFACT_ADMISSION"
test -s "$ARTIFACT_ADMISSION_BINDING"
grep -Fq 'failurePolicy: Fail' "$ARTIFACT_ADMISSION"
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ARTIFACT_ADMISSION"
grep -Fq 'kubernetes.io/metadata.name: "oc-opencrane-artifact-preprocessing"' "$ARTIFACT_ADMISSION"
grep -Fq 'request.userInfo.username == "system:serviceaccount:server-ns:agent-controller"' "$ARTIFACT_ADMISSION"
grep -Fq "object.metadata.name.matches('^artifact-preprocess-[a-f0-9]{24}$')" "$ARTIFACT_ADMISSION"
grep -Fq "object.spec.template.spec.serviceAccountName == 'artifact-preprocessor'" "$ARTIFACT_ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-artifact-preprocessor@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"" "$ARTIFACT_ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env[0].value == \"http://oc-opencrane-opencrane-server.server-ns.svc.cluster.local:8081\"" "$ARTIFACT_ADMISSION"
grep -Fq "object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-artifact-preprocessor'" "$ARTIFACT_ADMISSION"
grep -Fq 'quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity("512Mi")) == 0' "$ARTIFACT_ADMISSION"
grep -Fq "request.operation == 'CREATE' && object.spec.suspend == true" "$ARTIFACT_ADMISSION"
grep -Fq "oldObject.spec.suspend == true && object.spec.suspend == false" "$ARTIFACT_ADMISSION"
grep -Fq 'validationActions: [Deny]' "$ARTIFACT_ADMISSION_BINDING"
grep -Fq 'kubernetes.io/metadata.name: "oc-opencrane-artifact-preprocessing"' "$ARTIFACT_ADMISSION_BINDING"

# The controller receives both warm pools in one fixed map.
grep -A1 -F 'name: AGENT_CONTROLLER_WARM_PROFILES_JSON' "$MANIFEST" | grep -F '\"namespace\":\"oc-opencrane-runtime\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_WARM_PROFILES_JSON' "$MANIFEST" | grep -F '\"namespace\":\"oc-managed-warm-custom\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_WARM_PROFILES_JSON' "$MANIFEST" | grep -F '\"deploymentName\":\"oc-opencrane-personal-warm\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_WARM_PROFILES_JSON' "$MANIFEST" | grep -F '\"deploymentName\":\"oc-opencrane-managed-warm\"' >/dev/null
grep -A1 -F 'name: AGENT_RUNTIME_MANAGED_NAMESPACE' "$MANIFEST" | grep -F 'value: "oc-managed-warm-custom"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"namespace\":\"opencrane-mcp-executors\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"companionImage\":\"ghcr.io/elewa-git/opencrane-mcp-executor@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"namespace\":\"oc-opencrane-artifact-preprocessing\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"image\":\"ghcr.io/elewa-git/opencrane-artifact-preprocessor@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"serverServiceName\":\"oc-opencrane-opencrane-server\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"activeDeadlineSeconds\":300' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://oc-opencrane-opencrane-server.server-ns.svc.cluster.local:8081' >/dev/null
if grep -A1 -F 'name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://override.example:8081' >/dev/null; then
  echo "artifact worker broker must not inherit the mutable runtime endpoint override" >&2
  exit 1
fi
grep -B8 -A8 -F 'name: oc-opencrane-agent-controller' "$MANIFEST" | grep -F 'namespace: server-ns' >/dev/null

# Durable workflow settings and the release-local application database reach the controller only
# through fixed environment entries; no literal database URL is rendered into the Deployment.
grep -A4 -F 'name: DATABASE_URL' "$MANIFEST" | grep -F 'name: opencrane-app-db' >/dev/null
grep -A4 -F 'name: DATABASE_URL' "$MANIFEST" | grep -F 'key: DATABASE_URL' >/dev/null
grep -A1 -F 'name: OPENCRANE_SILO_ID' "$MANIFEST" | grep -F 'value: "oc"' >/dev/null
grep -A1 -F 'name: OPENCRANE_SERVER_SERVICE_NAME' "$MANIFEST" | grep -F 'value: "oc-opencrane-opencrane-server"' >/dev/null
grep -A3 -F 'name: POD_NAMESPACE' "$MANIFEST" | grep -F 'fieldPath: metadata.namespace' >/dev/null
grep -A1 -F 'name: OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE' "$MANIFEST" | grep -F 'value: "2"' >/dev/null
grep -A1 -F 'name: OPENCRANE_WORKFLOW_WORKER_CONCURRENCY' "$MANIFEST" | grep -F 'value: "2"' >/dev/null
grep -A1 -F 'name: OPENCRANE_WORKFLOW_POLL_INTERVAL_MS' "$MANIFEST" | grep -F 'value: "100"' >/dev/null
if grep -Fq 'AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS' "$MANIFEST"; then
  echo "agent-controller deployment still renders the retired outbox pruning loop" >&2
  exit 1
fi

# Helm keeps the namespace default-deny and selects the network paths for each warm profile.
test -s "$CONTROLLER_POLICY"
grep -Fq 'policyTypes: ["Ingress", "Egress"]' "$CONTROLLER_POLICY"
grep -Fq 'ingress: []' "$CONTROLLER_POLICY"
grep -Fq 'cnpg.io/poolerName: oc-postgres-pooler' "$CONTROLLER_POLICY"
grep -A3 -F 'cnpg.io/poolerName: oc-postgres-pooler' "$CONTROLLER_POLICY" | grep -F 'port: 5432' >/dev/null
if grep -Eq 'apiVersion: cilium.io/v2|kind: CiliumNetworkPolicy' "$MANIFEST"; then
  echo "warm runtime render retained Cilium-only network policy resources" >&2
  exit 1
fi
node "$WARM_POLICY_ASSERTIONS" "$MANIFEST"
grep -Fq 'opencrane.ai/runtime-release:' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: server-ns' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: kube-system' "$MANIFEST"

# Disabling only artifact preprocessing removes its controller profile and cross-namespace RBAC
# without disabling the controller's other workflow and reconciliation responsibilities.
if grep -Eq 'name: agent-controller-artifact-preprocessor|AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON|create or release artifact preprocessing Jobs' "$ARTIFACT_DISABLED"; then
  echo "disabled artifact preprocessing retained controller authority or profile" >&2
  exit 1
fi
# Provider actions execute in the server, so the runtime floor must not admit direct Obot traffic.
test -s "$SERVER_POLICY"
grep -Fq 'cidr: "10.43.0.1/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "10.43.0.1/32"' "$SERVER_POLICY" | grep -F 'port: 443' >/dev/null
grep -Fq 'cidr: "172.18.0.2/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$SERVER_POLICY" | grep -F 'port: 6443' >/dev/null
grep -Fq 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY" | grep -F 'port: 6443' >/dev/null

# Governed Job admission stays fail closed for skills, OCI MCP, and artifact preprocessing.
test -s "$ADMISSION"
grep -Fq 'failurePolicy: Fail' "$ADMISSION"
grep -A2 -F '  matchConstraints:' "$ADMISSION" | grep -F '    matchPolicy: Exact' >/dev/null
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ADMISSION"
grep -Fq 'resources: ["jobs"]' "$ADMISSION"
grep -Fq 'request.userInfo.username == "system:serviceaccount:server-ns:agent-controller"' "$ADMISSION"
if grep -Eq 'agent-runtime-a|opencrane-managed-agent-runtime|managed-agent-runtime-default' "$ADMISSION"; then
  echo "governed Job admission retained the old AgentRun Job grammar" >&2
  exit 1
fi
# The skill namespace receives controller Job create/get, so its fail-closed admission policy
# must bind the same identity to the exact suspended authoring envelope.
grep -Eq 'name: .*skill-authoring' "$ADMISSION"
grep -Fq 'values: ["skill-authoring"]' "$ADMISSION"
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ADMISSION"
grep -Fq "object.spec.suspend == true" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].name == 'skill-authoring'" "$ADMISSION"
grep -Fq "object.metadata.annotations['opencrane.ai/capability-reference'].matches('^skill-bootstrap-v1_[a-f0-9]{64}$')" "$ADMISSION"
grep -Fq "object.spec.template.metadata.annotations['opencrane.ai/capability-reference'] == object.metadata.annotations['opencrane.ai/capability-reference']" "$ADMISSION"
grep -Fq 'object.spec.template.metadata.labels.size() == 2' "$ADMISSION"
grep -Fq "object.spec.template.metadata.labels['opencrane.ai/skill-authoring-validation'] == object.metadata.labels['opencrane.ai/skill-authoring-validation']" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-skill-authoring@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env.size() == 3" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_SKILL_BOOTSTRAP_URL'" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_SKILL_TOKEN_PATH'" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH'" "$ADMISSION"
grep -Fq "object.spec.template.spec.volumes[1].name == 'bootstrap-reference'" "$ADMISSION"
grep -Fq "object.spec.template.spec.volumes[1].downwardAPI.items[0].fieldRef.fieldPath == \"metadata.annotations['opencrane.ai/capability-reference']\"" "$ADMISSION"
grep -Fq "object.spec.template.spec.volumes[2].name == 'scratch'" "$ADMISSION"

# OCI-backed MCP admission fixes the companion, token boundary, resources, and one-use release while
# leaving only the imported server digest dynamic.
grep -Eq 'name: .*mcp-executor' "$ADMISSION"
grep -Fq "object.metadata.name.matches('^mcp-exec-[a-f0-9]{24}$')" "$ADMISSION"
grep -Fq "request.operation == 'UPDATE' || object.spec.suspend == true" "$ADMISSION"
grep -Fq "object.spec.template.spec.initContainers[0].name == 'mcp-server'" "$ADMISSION"
grep -Fq "object.spec.template.spec.initContainers[0].image.matches('^[a-z0-9]" "$ADMISSION"
grep -Fq "object.spec.template.spec.initContainers[0].env" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].name == 'mcp-companion'" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-mcp-executor@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"" "$ADMISSION"
grep -Fq "object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-mcp-executor'" "$ADMISSION"
grep -Fq "object.spec.template.spec.initContainers[0].volumeMounts.size() == 1" "$ADMISSION"
grep -Fq "object.spec.template.metadata.annotations == object.metadata.annotations" "$ADMISSION"
grep -A1 -F 'name: AGENT_CONTROLLER_SKILL_AUTHORING_PROFILE_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://oc-opencrane-opencrane-server.server-ns.svc.cluster.local:8081/api/internal/agent-runtime' >/dev/null
if grep -A1 -F 'name: AGENT_CONTROLLER_SKILL_AUTHORING_PROFILE_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://override.example:8081' >/dev/null; then
  echo "governed worker bootstrap must not inherit the mutable runtime endpoint override" >&2
  exit 1
fi
if grep -Fq 'OPENCRANE_SKILL_CAPABILITY_REFERENCE' "$ADMISSION"; then
  echo "governed worker admission must project its opaque reference through a read-only file" >&2
  exit 1
fi
if grep -Fq 'request.subResource' "$ADMISSION"; then
  echo "Job-only admission must not dereference the optional subResource request field" >&2
  exit 1
fi
grep -Fq "request.operation == 'CREATE' ||" "$ADMISSION"
grep -Fq "oldObject.spec.suspend == true && object.spec.suspend == false" "$ADMISSION"
grep -Fq "oldObject.spec.suspend == true && object.spec.suspend == false" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers.size() == 1" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].livenessProbe)" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].readinessProbe)" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].startupProbe)" "$ADMISSION"
grep -Fq "object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds" "$ADMISSION"
grep -Fq "object.spec.template.spec.nodeName == ''" "$ADMISSION"
grep -Fq "object.spec.template.spec.terminationGracePeriodSeconds == 0" "$ADMISSION"
grep -Fq "object.spec.template.metadata.ownerReferences.size() == 0" "$ADMISSION"
grep -Fq 'usage: artifact-admission-conformance.sh <server-namespace> <artifact-namespace> <release-fullname> <server-internal-port>' "$ARTIFACT_CONFORMANCE"
grep -Fq '_expect_create_denied "wrong actor" "$WRONG_USER"' "$ARTIFACT_CONFORMANCE"
grep -Fq '_expect_create_denied "mutable image" "$CONTROLLER_USER"' "$ARTIFACT_CONFORMANCE"
grep -Fq '_expect_create_denied "foreign broker" "$CONTROLLER_USER"' "$ARTIFACT_CONFORMANCE"
grep -Fq '_expect_create_denied "host volume" "$CONTROLLER_USER"' "$ARTIFACT_CONFORMANCE"
grep -Fq '_expect_create_denied "unsuspended create" "$CONTROLLER_USER"' "$ARTIFACT_CONFORMANCE"
grep -Fq 'release plus an unrelated Job mutation was accepted' "$ARTIFACT_CONFORMANCE"
grep -Fq 'a released artifact preprocessing Job was resuspended' "$ARTIFACT_CONFORMANCE"
grep -Fq '        runAsUser: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        runAsGroup: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        fsGroup: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        fsGroupChangePolicy: OnRootMismatch' "$IDENTITY_CONFORMANCE"
grep -Fq '          type: RuntimeDefault' "$IDENTITY_CONFORMANCE"
grep -Fq 'for (let attempt = 1; attempt <= 10; attempt += 1)' "$IDENTITY_CONFORMANCE"
grep -Fq 'signal: AbortSignal.timeout(2000)' "$IDENTITY_CONFORMANCE"
grep -Fq 'if (response.status !== 200 && response.status !== 204)' "$IDENTITY_CONFORMANCE"
# The runtime envelope has no provider address, key environment, mount, or Secret grammar.
if grep -Eq 'OPENCRANE_RUNTIME_OBOT|obot-key|obotMcpBaseUrl' "$ADMISSION" "$MANIFEST"; then
  echo "runtime admission or profile still contains Obot material" >&2
  exit 1
fi
grep -Fq 'count/deployments.apps: "1"' "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'limits.memory: "20Gi"' "$MANAGED_RUNTIME_QUOTA"
if grep -Eq 'resources\.(requests|limits)\.[a-z]+ == quantity|emptyDir\.sizeLimit == quantity' "$ADMISSION"; then
  echo "admission compares a serialized resource string directly with a CEL Quantity" >&2
  exit 1
fi
grep -Fq "object.spec.selector.matchLabels.all" "$ADMISSION"
grep -Fq "'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name'" "$ADMISSION"
grep -Fq "object.spec.template == oldObject.spec.template" "$ADMISSION"
grep -Fq 'validationActions: [Deny]' "$MANIFEST"

# Disabled renders no controller-owned namespace, RBAC, network policy, profile map, or
# cluster-scoped admission residue.
grep -Fq 'cidr: "10.43.0.1/32"' "$DISABLED"
grep -A3 -F 'cidr: "10.43.0.1/32"' "$DISABLED" | grep -F 'port: 443' >/dev/null
grep -Fq 'cidr: "172.18.0.2/32"' "$DISABLED"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$DISABLED" | grep -Fq 'port: 6443'
# The exact runtime namespace names are anchored so workload-class resources do not count as
# controller residue when the controller is disabled.
if grep -Eq 'kind: ValidatingAdmissionPolicy|name: oc-opencrane-runtime$|name: oc-opencrane-managed-runtime$|name: oc-opencrane-warm-runtime|name: oc-opencrane-(personal|managed)-warm-(generic|claimed)$|opencrane.ai/runtime-release|AGENT_CONTROLLER_WARM_PROFILES_JSON' "$DISABLED"; then
  echo "disabled agent-controller rendered runtime authority" >&2
  exit 1
fi

# Invalid, same-as-server, or mutable image contracts fail before any resources render.
if render_enabled --set-string agentController.runtimeNamespace='bad/name' >/dev/null 2>&1; then
  echo "invalid runtime namespace was accepted" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeNamespace=server-ns >/dev/null 2>&1; then
  echo "server namespace was accepted as the runtime namespace" >&2
  exit 1
fi
if render_enabled --set-string agentController.warmRuntime.managedNamespace=oc-opencrane-runtime >/dev/null 2>&1; then
  echo "personal namespace was accepted as the managed runtime namespace" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.name=managed-default >/dev/null 2>&1; then
  echo "reserved managed profile name was accepted for the personal runtime" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.name=bad/name >/dev/null 2>&1; then
  echo "invalid personal runtime profile name was accepted" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.image.digest=latest >/dev/null 2>&1; then
  echo "mutable runtime image reference was accepted" >&2
  exit 1
fi
if render_enabled --set-string clustertenantManager.database.existingSecret= >/dev/null 2>&1; then
  echo "durable controller rendered without the release-local application database" >&2
  exit 1
fi
if render_enabled --set-string artifactPreprocessor.namespace=opencrane-mcp-executors >/dev/null 2>&1; then
  echo "artifact preprocessing reused another governed workload namespace" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.resources.requests.cpu=10x >/dev/null 2>&1; then
  echo "invalid runtime CPU quantity was accepted" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.resources.limits.memory=1GB >/dev/null 2>&1; then
  echo "invalid runtime memory quantity was accepted" >&2
  exit 1
fi
if render_enabled --set agentController.runtimeProfile.resources.requests.cpu=2 >/dev/null 2>&1; then
  echo "non-string runtime CPU quantity was accepted" >&2
  exit 1
fi
if render_enabled --kube-version 1.29.9 >/dev/null 2>&1; then
  echo "Kubernetes 1.29 was accepted despite the stable admission API requirement" >&2
  exit 1
fi
if render_enabled --set sharedPlatform.litellm.mode=shared >/dev/null 2>&1; then
  echo "agent controller accepted shared LiteLLM despite requiring its same-silo Service boundary" >&2
  exit 1
fi
if helm template oc "$CHART_ROOT" --namespace server-ns \
  --set agentController.enabled=true \
  --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' >/dev/null 2>&1; then
  echo "controller rendered without immutable image digests" >&2
  exit 1
fi

echo "agent-controller namespace, RBAC, network and admission contract passed"
