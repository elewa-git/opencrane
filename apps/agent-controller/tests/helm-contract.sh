#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CHART_ROOT="${OPENCRANE_HELM_CHART_ROOT:-$ROOT/apps/_infra/deploy-k8s}"
CONFORMANCE="$ROOT/apps/agent-controller/tests/admission-conformance.sh"
IDENTITY_CONFORMANCE="$ROOT/apps/agent-controller/tests/identity-conformance.sh"
MANIFEST="$(mktemp)"
DISABLED="$(mktemp)"
ROLE="$(mktemp)"
BINDING="$(mktemp)"
RUNTIME_NAMESPACE="$(mktemp)"
RUNTIME_QUOTA="$(mktemp)"
ADMISSION="$(mktemp)"
SERVER_POLICY="$(mktemp)"
CONTROLLER_POLICY="$(mktemp)"
RUNTIME_DENY="$(mktemp)"
RUNTIME_EGRESS="$(mktemp)"
trap 'rm -f "$MANIFEST" "$DISABLED" "$ROLE" "$BINDING" "$RUNTIME_NAMESPACE" "$RUNTIME_QUOTA" "$ADMISSION" "$SERVER_POLICY" "$CONTROLLER_POLICY" "$RUNTIME_DENY" "$RUNTIME_EGRESS"' EXIT

render_enabled() {
  helm template oc "$CHART_ROOT" \
    --namespace server-ns \
    --set agentController.enabled=true \
    --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'agentController.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    --set agentController.kubernetesApiServerEndpointPort=6443 \
    "$@"
}

render_enabled > "$MANIFEST"
render_enabled --set agentController.enabled=false > "$DISABLED"

awk 'BEGIN { RS="---" } $0 ~ /\nkind: Role\n/ && $0 ~ /\n  name: agent-controller\n/ { print $0 }' "$MANIFEST" > "$ROLE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: RoleBinding\n/ && $0 ~ /\n  name: agent-controller\n/ { print $0 }' "$MANIFEST" > "$BINDING"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: Namespace\n/ && $0 ~ /\n  name: oc-opencrane-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_NAMESPACE"
awk 'BEGIN { RS="---" } $0 ~ /\nkind: ResourceQuota\n/ && $0 ~ /\n  name: oc-opencrane-agent-runtime\n/ { print $0 }' "$MANIFEST" > "$RUNTIME_QUOTA"
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
grep -A4 -F 'name: agent-runtime-default' "$MANIFEST" | grep -Fq 'namespace: oc-opencrane-runtime'
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
if ! grep -A1 'resources: \["secrets"\]' "$ROLE" | grep -Fq 'verbs: ["create"]'; then
  echo "agent-controller secrets rule must be create-only" >&2
  exit 1
fi
if grep -A1 'resources: \["secrets"\]' "$ROLE" | grep -Eq '"(get|list|patch|delete|update|watch)"'; then
  echo "agent-controller secrets rule exceeds create-only" >&2
  exit 1
fi
if grep -Eq 'networkpolicies|serviceaccounts|deployments|configmaps|"(delete|update|watch)"' "$ROLE"; then
  echo "agent-controller Role exceeds the accepted Job/Pod/Secret boundary" >&2
  exit 1
fi
test -s "$BINDING"
grep -Fq 'namespace: oc-opencrane-runtime' "$BINDING"
grep -A4 -F 'kind: ServiceAccount' "$BINDING" | grep -Fq 'namespace: server-ns'

# Both processes receive the literal cross-namespace contract; neither infers it from Pod metadata.
grep -A2 -F 'name: AGENT_RUNTIME_NAMESPACE' "$MANIFEST" | grep -Fq 'value: "oc-opencrane-runtime"'
grep -A2 -F 'name: AGENT_RUNTIME_NAMESPACE' "$MANIFEST" | grep -Fq 'value: "oc-opencrane-runtime"'
grep -B8 -A8 -F 'name: oc-opencrane-agent-controller' "$MANIFEST" | grep -Fq 'namespace: server-ns'

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
grep -A20 -F 'name: oc-opencrane-agent-runtime-egress' "$MANIFEST" | grep -Fq 'namespace: oc-opencrane-runtime'
grep -Fq 'opencrane.ai/runtime-release:' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: server-ns' "$MANIFEST"
grep -Fq 'kubernetes.io/metadata.name: kube-system' "$MANIFEST"
grep -Fq 'app.kubernetes.io/component: litellm' "$RUNTIME_EGRESS"
grep -Fq 'port: 4000' "$RUNTIME_EGRESS"
test -s "$SERVER_POLICY"
grep -Fq 'cidr: "10.43.0.1/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "10.43.0.1/32"' "$SERVER_POLICY" | grep -Fq 'port: 443'
grep -Fq 'cidr: "172.18.0.2/32"' "$SERVER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$SERVER_POLICY" | grep -Fq 'port: 6443'
grep -Fq 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$CONTROLLER_POLICY" | grep -Fq 'port: 6443'

# Admission is fail closed, scoped by the release-unique namespace label, and grants no rights.
test -s "$ADMISSION"
grep -Fq 'failurePolicy: Fail' "$ADMISSION"
grep -A2 -F '  matchConstraints:' "$ADMISSION" | grep -Fq '    matchPolicy: Exact'
grep -Fq 'operations: ["CREATE", "UPDATE"]' "$ADMISSION"
grep -Fq 'resources: ["jobs"]' "$ADMISSION"
grep -Fq 'request.userInfo.username == "system:serviceaccount:server-ns:agent-controller"' "$ADMISSION"
if grep -Fq 'request.subResource' "$ADMISSION"; then
  echo "Job-only admission must not dereference the optional subResource request field" >&2
  exit 1
fi
grep -Fq "request.operation == 'CREATE' && object.spec.suspend == true" "$ADMISSION"
grep -Fq "oldObject.spec.suspend == true && object.spec.suspend == false" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers.size() == 1" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].livenessProbe)" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].readinessProbe)" "$ADMISSION"
grep -Fq "!has(object.spec.template.spec.containers[0].startupProbe)" "$ADMISSION"
grep -Fq "object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds" "$ADMISSION"
grep -Fq "object.spec.template.spec.nodeName == ''" "$ADMISSION"
grep -Fq "object.spec.template.spec.terminationGracePeriodSeconds == 0" "$ADMISSION"
grep -Fq "object.spec.template.metadata.ownerReferences.size() == 0" "$ADMISSION"
grep -Fq "object.spec.template.spec.containers[0].image == \"ghcr.io/italanta/opencrane-agent-runtime@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"" "$ADMISSION"
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
grep -Fq 'quantity(object.spec.template.spec.volumes[3].emptyDir.sizeLimit).compareTo(quantity("1Gi")) == 0' "$ADMISSION"
if grep -Eq 'resources\.(requests|limits)\.[a-z]+ == quantity|emptyDir\.sizeLimit == quantity' "$ADMISSION"; then
  echo "admission compares a serialized resource string directly with a CEL Quantity" >&2
  exit 1
fi
grep -Fq "object.spec.selector.matchLabels.all" "$ADMISSION"
grep -Fq "'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name'" "$ADMISSION"
grep -Fq "object.spec.template == oldObject.spec.template" "$ADMISSION"
grep -Fq 'validationActions: [Deny]' "$MANIFEST"

# Disabled still tells OpenCrane the deployment-owned namespace boundary, but renders no namespace,
# controller RBAC, network policy or cluster-scoped admission residue.
grep -A2 -F 'name: AGENT_RUNTIME_NAMESPACE' "$DISABLED" | grep -Fq 'value: "oc-opencrane-runtime"'
grep -Fq 'cidr: "10.43.0.1/32"' "$DISABLED"
grep -A3 -F 'cidr: "10.43.0.1/32"' "$DISABLED" | grep -Fq 'port: 443'
grep -Fq 'cidr: "172.18.0.2/32"' "$DISABLED"
grep -A3 -F 'cidr: "172.18.0.2/32"' "$DISABLED" | grep -Fq 'port: 6443'
if grep -Eq 'kind: ValidatingAdmissionPolicy|kind: Namespace|name: agent-controller|opencrane.ai/runtime-release' "$DISABLED"; then
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
