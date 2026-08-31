#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
source "$ROOT/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
CONFORMANCE="$ROOT/apps/agent-controller/tests/admission-conformance.sh"
IDENTITY_CONFORMANCE="$ROOT/apps/agent-controller/tests/identity-conformance.sh"
MANIFEST="$(mktemp)"
DISABLED="$(mktemp)"
ROLE="$(mktemp)"
BINDING="$(mktemp)"
CLEANUP_ROLE="$(mktemp)"
CLEANUP_BINDING="$(mktemp)"
RUNTIME_NAMESPACE="$(mktemp)"
RUNTIME_QUOTA="$(mktemp)"
MANAGED_RUNTIME_QUOTA="$(mktemp)"
ADMISSION="$(mktemp)"
SKILL_URL_OVERRIDE="$(mktemp)"
SERVER_POLICY="$(mktemp)"
CONTROLLER_POLICY="$(mktemp)"
RUNTIME_DENY="$(mktemp)"
RUNTIME_EGRESS="$(mktemp)"
prepare_current_chart_sources
trap 'cleanup_current_chart_sources; rm -f "$MANIFEST" "$DISABLED" "$ROLE" "$BINDING" "$CLEANUP_ROLE" "$CLEANUP_BINDING" "$RUNTIME_NAMESPACE" "$RUNTIME_QUOTA" "$MANAGED_RUNTIME_QUOTA" "$ADMISSION" "$SKILL_URL_OVERRIDE" "$SERVER_POLICY" "$CONTROLLER_POLICY" "$RUNTIME_DENY" "$RUNTIME_EGRESS"' EXIT
CHART_ROOT="$(current_chart_sources_dir)"

render_enabled() {
  helm template oc "$CHART_ROOT" \
    --namespace server-ns \
    --set agentController.enabled=true \
    --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    --set-string managedAgentRuntimePlane.managedAgentRuntime.namespace=oc-opencrane-managed-runtime \
    --set-string managedAgentRuntimePlane.managedAgentRuntime.serviceAccountName=managed-agent-runtime-default \
    --set-string agentController.skillWorkloadProfiles.authoring.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    --set-string agentController.skillWorkloadProfiles.toolRunner.image.digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
    --set-string opencrane-mcp-executor.mcpExecutor.image.digest=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    --set agentController.kubernetesApiServerEndpointPort=6443 \
    "$@"
}

render_enabled > "$MANIFEST"
render_enabled --set agentController.enabled=false > "$DISABLED"
render_enabled --set-string agentController.openCraneInternalUrl=http://override.example:8081 > "$SKILL_URL_OVERRIDE"

awk 'BEGIN { RS="---" } $0 ~ /\nkind: Role\n/ && $0 ~ /\n  name: agent-controller\n/ { print $0 }' "$MANIFEST" > "$ROLE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: RoleBinding\n/ && $0 ~ /\n  name: agent-controller\n/ { print $0 }' "$MANIFEST" > "$BINDING"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: Role\n/ && $0 ~ /\n  name: oc-opencrane-runtime-cleanup\n/ { print $0 }' "$MANIFEST" > "$CLEANUP_ROLE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: RoleBinding\n/ && $0 ~ /\n  name: oc-opencrane-runtime-cleanup\n/ { print $0 }' "$MANIFEST" > "$CLEANUP_BINDING"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: Namespace\n/ && $0 ~ /\n  name: oc-opencrane-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_NAMESPACE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ResourceQuota\n/ && $0 ~ /\n  name: oc-opencrane-agent-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_QUOTA"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ResourceQuota\n/ && $0 ~ /\n  name: managed-agent-runtime\n/ && $0 ~ /\n  namespace: oc-opencrane-managed-runtime\n/ { print $0 }' "$MANIFEST" > "$MANAGED_RUNTIME_QUOTA"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ValidatingAdmissionPolicy\n/ { print $0 }' "$MANIFEST" > "$ADMISSION"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-opencrane-server\n/ { print $0 }' "$MANIFEST" > "$SERVER_POLICY"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-agent-controller\n/ { print $0 }' "$MANIFEST" > "$CONTROLLER_POLICY"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-agent-runtime-default-deny\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_DENY"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: NetworkPolicy\n/ && $0 ~ /\n  name: oc-opencrane-agent-runtime-egress\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_EGRESS"

# One deterministic restricted namespace owns only the runtime identity and workloads.
test -s "$RUNTIME_NAMESPACE"
grep -Fq 'opencrane.ai/runtime-release:' "$RUNTIME_NAMESPACE"
grep -Fq 'pod-security.kubernetes.io/enforce: restricted' "$RUNTIME_NAMESPACE"
grep -Fq 'pod-security.kubernetes.io/enforce-version: latest' "$RUNTIME_NAMESPACE"
grep -Fq 'name: agent-runtime-default' "$MANIFEST"
grep -A4 -F 'name: agent-runtime-default' "$MANIFEST" | grep -F 'namespace: oc-opencrane-runtime' >/dev/null
test -s "$RUNTIME_QUOTA"
grep -Fq 'pods: "20"' "$RUNTIME_QUOTA"
grep -Fq 'count/jobs.batch: "20"' "$RUNTIME_QUOTA"
grep -Fq 'requests.cpu: "2"' "$RUNTIME_QUOTA"
grep -Fq 'requests.memory: "4Gi"' "$RUNTIME_QUOTA"
grep -Fq 'limits.cpu: "20"' "$RUNTIME_QUOTA"
grep -Fq 'limits.memory: "20Gi"' "$RUNTIME_QUOTA"

# The controller remains in server-ns while its least-privilege Role lives in the runtime namespace.
test -s "$ROLE"
grep -Fq 'namespace: oc-opencrane-runtime' "$ROLE"
grep -Fq 'resources: ["jobs"]' "$ROLE"
grep -Fq 'verbs: ["get", "create", "patch"]' "$ROLE"
grep -Fq 'resources: ["pods"]' "$ROLE"
grep -Fq 'verbs: ["list"]' "$ROLE"
# Attempt-key Secrets are create-only in the runtime namespace: the exact resource+verb must appear,
# and the secrets rule must grant nothing beyond create.
grep -Fq 'resources: ["secrets"]' "$ROLE"
if ! grep -A1 'resources: \["secrets"\]' "$ROLE" | grep -F 'verbs: ["create"]' >/dev/null; then
  echo "agent-controller secrets rule must be create-only" >&2
  exit 1
fi
if grep -A1 'resources: \["secrets"\]' "$ROLE" | grep -E '"(get|list|patch|delete|update|watch)"' >/dev/null; then
  echo "agent-controller secrets rule exceeds create-only" >&2
  exit 1
fi
if grep -Eq 'networkpolicies|serviceaccounts|deployments|configmaps|"(delete|update|watch)"' "$ROLE"; then
  echo "agent-controller Role exceeds the accepted Job/Pod/Secret boundary" >&2
  exit 1
fi
test -s "$BINDING"
grep -Fq 'namespace: oc-opencrane-runtime' "$BINDING"
grep -A4 -F 'kind: ServiceAccount' "$BINDING" | grep -F 'namespace: server-ns' >/dev/null
# The same controller KSA has an independently namespaced least-privilege RoleBinding for managed
# runtime attempts; it receives no cluster role and no permission outside the two exact namespaces.
grep -A28 -F 'namespace: oc-opencrane-managed-runtime' "$MANIFEST" | grep -F 'name: agent-controller' >/dev/null
grep -A28 -F 'namespace: oc-opencrane-managed-runtime' "$MANIFEST" | grep -F 'resources: ["jobs"]' >/dev/null
grep -A28 -F 'namespace: oc-opencrane-managed-runtime' "$MANIFEST" | grep -F 'resources: ["pods"]' >/dev/null
grep -A28 -F 'namespace: oc-opencrane-managed-runtime' "$MANIFEST" | grep -F 'resources: ["secrets"]' >/dev/null
grep -A28 -F 'namespace: oc-opencrane-managed-runtime' "$MANIFEST" | grep -F 'namespace: server-ns' >/dev/null

# Only the OpenCrane server receives runtime Job deletion, through a separately named Role.
test -s "$CLEANUP_ROLE"
grep -Fq 'namespace: oc-opencrane-runtime' "$CLEANUP_ROLE"
grep -Fq 'resources: ["jobs"]' "$CLEANUP_ROLE"
grep -Fq 'verbs: ["get", "delete"]' "$CLEANUP_ROLE"
if grep -Eq '"(create|list|patch|update|watch)"|resources: \["(pods|secrets)"\]' "$CLEANUP_ROLE"; then
  echo "runtime cleanup Role exceeds server-owned Job observation/deletion authority" >&2
  exit 1
fi
test -s "$CLEANUP_BINDING"
grep -A4 -F 'kind: ServiceAccount' "$CLEANUP_BINDING" | grep -F 'name: oc-opencrane-opencrane-server' >/dev/null
grep -A4 -F 'kind: ServiceAccount' "$CLEANUP_BINDING" | grep -F 'namespace: server-ns' >/dev/null

# Governed skill namespaces are derived from their owning charts. Their controller Roles can create,
# exact-adopt, and conditionally release Jobs, plus list the exact Job-owned Pod for registration.
grep -A16 -F 'namespace: opencrane-skill-authoring' "$MANIFEST" | grep -F 'name: agent-controller-skill-workloads' >/dev/null
grep -A16 -F 'namespace: opencrane-tools' "$MANIFEST" | grep -F 'name: agent-controller-skill-workloads' >/dev/null
grep -A16 -F 'name: agent-controller-skill-workloads' "$MANIFEST" | grep -F 'verbs: ["get", "create", "patch"]' >/dev/null
grep -A16 -F 'name: agent-controller-skill-workloads' "$MANIFEST" | grep -F 'resources: ["pods"]' >/dev/null
grep -A16 -F 'name: agent-controller-skill-workloads' "$MANIFEST" | grep -F 'verbs: ["list"]' >/dev/null
if grep -A16 -F 'name: agent-controller-skill-workloads' "$MANIFEST" | grep -E '"(delete|update|watch)"' >/dev/null; then
  echo "skill workload Roles exceed fenced Job release and Pod discovery authority" >&2
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

# The controller receives both profile-owned namespaces in one immutable map; it never gets a
# process-wide runtime namespace that could let one profile borrow another's RoleBinding.
grep -A1 -F 'name: AGENT_CONTROLLER_PROFILES_JSON' "$MANIFEST" | grep -F '\"namespace\":\"oc-opencrane-runtime\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_PROFILES_JSON' "$MANIFEST" | grep -F '\"namespace\":\"oc-opencrane-managed-runtime\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_PROFILES_JSON' "$MANIFEST" | grep -F '\"identityProfile\":\"managed\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_PROFILES_JSON' "$MANIFEST" | grep -F '\"serviceAccountName\":\"managed-agent-runtime-default\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"namespace\":\"opencrane-mcp-executors\"' >/dev/null
grep -A1 -F 'name: AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON' "$MANIFEST" | grep -F '\"companionImage\":\"ghcr.io/elewa-git/opencrane-mcp-executor@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"' >/dev/null
grep -B8 -A8 -F 'name: oc-opencrane-agent-controller' "$MANIFEST" | grep -F 'namespace: server-ns' >/dev/null

# Helm, not the controller, owns the namespace-wide network boundary.
test -s "$CONTROLLER_POLICY"
grep -Fq 'policyTypes: ["Ingress", "Egress"]' "$CONTROLLER_POLICY"
grep -Fq 'ingress: []' "$CONTROLLER_POLICY"
test -s "$RUNTIME_DENY"
grep -Fq 'policyTypes: ["Ingress", "Egress"]' "$RUNTIME_DENY"
grep -Fq 'ingress: []' "$RUNTIME_DENY"
grep -Fq 'egress: []' "$RUNTIME_DENY"
test -s "$RUNTIME_EGRESS"
grep -Fq 'policyTypes: ["Egress"]' "$RUNTIME_EGRESS"
if grep -Fq 'ingress:' "$RUNTIME_EGRESS"; then
  echo "runtime egress policy redundantly owns ingress" >&2
  exit 1
fi
grep -A20 -F 'name: oc-opencrane-agent-runtime-egress' "$MANIFEST" | grep -F 'namespace: oc-opencrane-runtime' >/dev/null
grep -Fq 'opencrane.ai/runtime-release:' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: server-ns' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: kube-system' "$MANIFEST"
grep -Fq 'app.kubernetes.io/component: litellm' "$RUNTIME_EGRESS"
grep -Fq 'port: 4000' "$RUNTIME_EGRESS"
# Provider actions execute in the server, so the runtime floor must not admit direct Obot traffic.
if grep -Fq 'app.kubernetes.io/component: mcp-gateway' "$RUNTIME_EGRESS"; then
  echo "runtime egress must not reach the MCP gateway" >&2
  exit 1
fi
test -s "$SERVER_POLICY"
grep -Fq 'cidr: "10.43.0.1/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "10.43.0.1/32"' "$SERVER_POLICY" | grep -F 'port: 443' >/dev/null
grep -Fq 'cidr: "172.18.0.2/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$SERVER_POLICY" | grep -F 'port: 6443' >/dev/null
grep -Fq 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY" | grep -F 'port: 6443' >/dev/null

# Admission is fail closed, scoped by the release-unique namespace label, and grants no rights.
test -s "$ADMISSION"
grep -Fq 'failurePolicy: Fail' "$ADMISSION"
grep -A2 -F '  matchConstraints:' "$ADMISSION" | grep -F '    matchPolicy: Exact' >/dev/null
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ADMISSION"
grep -Fq 'resources: ["jobs"]' "$ADMISSION"
grep -Fq 'request.userInfo.username == "system:serviceaccount:server-ns:agent-controller"' "$ADMISSION"
grep -Fq 'name: oc-opencrane-runtime-70514623e3-personal-default' "$ADMISSION"
grep -Fq 'name: oc-opencrane-runtime-70514623e3-managed-default' "$ADMISSION"
grep -Fq 'kubernetes.io/metadata.name: "oc-opencrane-runtime"' "$ADMISSION"
grep -Fq 'kubernetes.io/metadata.name: "oc-opencrane-managed-runtime"' "$ADMISSION"
grep -Fq '"managed-agent-runtime-default"' "$ADMISSION"
grep -Fq '"opencrane-managed-agent-runtime"' "$ADMISSION"
# Skill namespaces also receive controller Job create/get, so their own fail-closed admission policy
# must bind the same identity to the exact suspended, class-specific worker envelopes.
grep -Eq 'name: .*skill-workloads' "$ADMISSION"
grep -Fq 'values: ["skill-authoring", "tool-runner"]' "$ADMISSION"
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ADMISSION"
grep -Fq "object.spec.suspend == true" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].name == 'skill-authoring'" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].name == 'tool-runner'" "$ADMISSION"
grep -Fq "object.metadata.annotations['opencrane.ai/capability-reference'].matches('^skill-bootstrap-v1_[a-f0-9]{64}$')" "$ADMISSION"
grep -Fq "object.spec.template.metadata.annotations['opencrane.ai/capability-reference'] == object.metadata.annotations['opencrane.ai/capability-reference']" "$ADMISSION"
grep -Fq 'object.spec.template.metadata.labels.size() == 2' "$ADMISSION"
grep -Fq "object.spec.template.metadata.labels['opencrane.ai/skill-workload'] == object.metadata.labels['opencrane.ai/skill-workload']" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-skill-authoring@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-tool-runner@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"" "$ADMISSION"
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
grep -A1 -F 'name: AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://oc-opencrane-opencrane-server.server-ns.svc.cluster.local:8081/api/internal/agent-runtime' >/dev/null
if grep -A1 -F 'name: AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON' "$SKILL_URL_OVERRIDE" | grep -F 'http://override.example:8081' >/dev/null; then
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
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/elewa-git/opencrane-agent-runtime@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"" "$ADMISSION"
grep -Fq 'quantity(object.spec.template.spec.containers[0].resources.requests.cpu).compareTo(quantity("100m")) == 0' "$ADMISSION"
grep -Fq 'quantity(object.spec.template.spec.containers[0].resources.requests.memory).compareTo(quantity("128Mi")) == 0' "$ADMISSION"
grep -Fq 'quantity(object.spec.template.spec.containers[0].resources.limits.cpu).compareTo(quantity("1000m")) == 0' "$ADMISSION"
grep -Fq 'quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity("1Gi")) == 0' "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env.size() == 5" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].envFrom)" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_RUNTIME_LITELLM_BASE_URL'" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].volumeMounts.size() == 4" "$ADMISSION"
grep -Fq 'SERVER_INTERNAL_PORT="$4"' "$CONFORMANCE"
grep -Fq 'LITELLM_PORT="$5"' "$CONFORMANCE"
if grep -Fq 'cluster.local:3001' "$CONFORMANCE"; then
  echo "Admission conformance must use the deployed internal server port" >&2
  exit 1
fi
grep -Fq '        runAsUser: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        runAsGroup: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        fsGroup: 65532' "$IDENTITY_CONFORMANCE"
grep -Fq '        fsGroupChangePolicy: OnRootMismatch' "$IDENTITY_CONFORMANCE"
grep -Fq '          type: RuntimeDefault' "$IDENTITY_CONFORMANCE"
grep -Fq 'for (let attempt = 1; attempt <= 10; attempt += 1)' "$IDENTITY_CONFORMANCE"
grep -Fq 'signal: AbortSignal.timeout(2000)' "$IDENTITY_CONFORMANCE"
grep -Fq 'if (response.status !== 200 && response.status !== 204)' "$IDENTITY_CONFORMANCE"
grep -Fq "object.spec.template.spec.volumes.size() == 4" "$ADMISSION"
grep -Fq "object.spec.template.spec.volumes[2].name == 'litellm-key'" "$ADMISSION"
grep -Fq "secret.name.matches('^litellm-key-[a-f0-9]{32}$')" "$ADMISSION"
# The runtime envelope has no provider address, key environment, mount, or Secret grammar.
if grep -Eq 'OPENCRANE_RUNTIME_OBOT|obot-key|obotMcpBaseUrl' "$ADMISSION" "$MANIFEST"; then
  echo "runtime admission or profile still contains Obot material" >&2
  exit 1
fi
grep -Fq 'quantity(object.spec.template.spec.volumes[3].emptyDir.sizeLimit).compareTo(quantity("1Gi")) == 0' "$ADMISSION"
grep -Fq 'count/jobs.batch: "20"' "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'count/secrets: "20"' "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'limits.memory: "20Gi"' "$MANAGED_RUNTIME_QUOTA"
grep -Fq 'count/secrets: "20"' "$RUNTIME_QUOTA"
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
# `name: oc-opencrane-runtime` is anchored so the server-owned `oc-opencrane-runtime-cleanup`
# RBAC (rendered by the opencrane-server chart regardless of the controller switch) is not
# misread as controller residue.
if grep -Eq 'kind: ValidatingAdmissionPolicy|name: oc-opencrane-runtime$|name: oc-opencrane-managed-runtime$|name: oc-opencrane-agent-runtime|opencrane.ai/runtime-release|AGENT_CONTROLLER_PROFILES_JSON' "$DISABLED"; then
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
if render_enabled --set-string managedAgentRuntimePlane.managedAgentRuntime.namespace=oc-opencrane-runtime >/dev/null 2>&1; then
  echo "personal namespace was accepted as the managed runtime namespace" >&2
  exit 1
fi
if render_enabled --set-string managedAgentRuntimePlane.managedAgentRuntime.serviceAccountName=agent-runtime-default >/dev/null 2>&1; then
  echo "personal runtime ServiceAccount was accepted as the managed runtime identity" >&2
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
if render_enabled --set managedAgentRuntimePlane.managedAgentRuntime.egress.channelProxyPort=8089 >/dev/null 2>&1; then
  echo "managed runtime egress accepted a channel-proxy port that differs from the Service" >&2
  exit 1
fi
if render_enabled --set managedAgentRuntimePlane.managedAgentRuntime.egress.artifactServicePort=8089 >/dev/null 2>&1; then
  echo "managed runtime egress accepted an ArtifactStore port that differs from the Service" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.serviceAccountName=agent-controller >/dev/null 2>&1; then
  echo "controller identity was accepted as the runtime ServiceAccount" >&2
  exit 1
fi
if render_enabled --set-string agentController.runtimeProfile.image.digest=latest >/dev/null 2>&1; then
  echo "mutable runtime image reference was accepted" >&2
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
