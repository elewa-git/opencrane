#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ensure_umbrella_chart_dependencies

VALUES=(
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
  --set agentSandbox.enabled=true
  --set-string agentSandbox.namespace=opencrane-testv5
  --set-string agentSandbox.runtimeClassName=gvisor
  --set-string agentSandbox.serviceAccountName=agent-sandbox-runtime
  --set-string 'agentSandbox.profiles[0].profileRevisionId=profile-revision-developer-v1'
  --set-string 'agentSandbox.profiles[0].name=developer'
  --set-string 'agentSandbox.profiles[0].poolName=developer-pool'
  --set-string 'agentSandbox.profiles[0].image.repository=registry.invalid/opencrane-agent-runtime'
  --set-string 'agentSandbox.profiles[0].image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  --set-string 'agentSandbox.profiles[0].image.pullPolicy=IfNotPresent'
  --set-string 'agentSandbox.profiles[0].resources.requests.cpu=100m'
  --set-string 'agentSandbox.profiles[0].resources.requests.memory=128Mi'
  --set-string 'agentSandbox.profiles[0].resources.limits.cpu=500m'
  --set-string 'agentSandbox.profiles[0].resources.limits.memory=512Mi')

rendered="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --show-only templates/app-rollups.yaml)"
template="$(awk 'BEGIN { RS="---" } /kind: SandboxTemplate/ && /name: opencrane-testv5-developer-template/ { print }' <<<"$rendered")"
pool="$(awk 'BEGIN { RS="---" } /kind: SandboxWarmPool/ && /name: developer-pool/ { print }' <<<"$rendered")"
role="$(awk 'BEGIN { RS="---" } /kind: Role/ && /name: opencrane-testv5-agent-sandbox-claims/ { print }' <<<"$rendered")"
policy="$(awk 'BEGIN { RS="---" } /kind: ValidatingAdmissionPolicy/ && /name: opencrane-testv5-agent-sandbox-claims/ { print }' <<<"$rendered")"
binding="$(awk 'BEGIN { RS="---" } /kind: ValidatingAdmissionPolicyBinding/ && /name: opencrane-testv5-agent-sandbox-claims/ { print }' <<<"$rendered")"
profile_config="$(awk 'BEGIN { RS="---" } /kind: ConfigMap/ && /name: opencrane-testv5-conversation-computer-profiles/ { print }' <<<"$rendered")"
runtime_bootstrap="$(awk 'BEGIN { RS="---" } /kind: ConfigMap/ && /name: opencrane-testv5-agent-sandbox-runtime-bootstrap/ { print }' <<<"$rendered")"
server_deployment="$(awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-testv5-opencrane/ { print }' <<<"$rendered")"

[[ -n "$template" && -n "$pool" && -n "$role" && -n "$policy" && -n "$binding" && -n "$profile_config" && -n "$runtime_bootstrap" && -n "$server_deployment" ]]
grep -Fq 'apiVersion: extensions.agents.x-k8s.io/v1beta1' <<<"$template"
grep -Fq 'image: "registry.invalid/opencrane-agent-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' <<<"$template"
grep -Fq 'runtimeClassName: gvisor' <<<"$template"
grep -Fq 'serviceAccountName: agent-sandbox-runtime' <<<"$template"
grep -Fq 'automountServiceAccountToken: false' <<<"$template"
grep -Fq 'app.kubernetes.io/instance: opencrane-testv5' <<<"$template"
grep -Fq 'name: conversation-computer-runtime-bootstrap' <<<"$template"
grep -Fq 'mountPath: /var/run/opencrane/conversation-computer' <<<"$template"
grep -Fq 'name: conversation-computer-runtime-token' <<<"$template"
grep -Fq 'mountPath: /var/run/secrets/opencrane/conversation-computer' <<<"$template"
grep -Fq 'serviceAccountToken:' <<<"$template"
grep -Fq 'audience: "opencrane-conversation-computer-runtime"' <<<"$template"
grep -Fq 'expirationSeconds: 600' <<<"$template"
grep -Fq 'path: token' <<<"$template"
grep -Fq 'enableServiceLinks: false' <<<"$template"
grep -Fq 'readOnlyRootFilesystem: true' <<<"$template"
grep -Fq 'drop: ["ALL"]' <<<"$template"
grep -Fq 'envVarsInjectionPolicy: Disallowed' <<<"$template"
grep -Fq 'volumeClaimTemplatesPolicy: Disallowed' <<<"$template"
grep -Fq 'replicas: 0' <<<"$pool"
grep -Fq 'sandboxTemplateRef:' <<<"$pool"
grep -Fq 'name: opencrane-testv5-developer-template' <<<"$pool"
grep -Fq 'apiGroups: ["extensions.agents.x-k8s.io"]' <<<"$role"
grep -Fq 'resources: ["sandboxclaims"]' <<<"$role"
grep -Fq 'verbs: ["create", "get"]' <<<"$role"
if grep -Eq '"(delete|list|watch|patch|update)"' <<<"$role"; then
  echo "Agent Sandbox server Role is broader than create/get" >&2
  exit 1
fi
grep -Fq 'apiVersions: ["v1beta1"]' <<<"$policy"
grep -Fq 'resources: ["sandboxclaims"]' <<<"$policy"
grep -Fq 'excludeResourceRules:' <<<"$policy"
grep -Fq 'resources: ["sandboxclaims/status"]' <<<"$policy"
grep -Fq "request.operation == 'CREATE'" <<<"$policy"
grep -Fq "object.metadata.labels.size() == 4" <<<"$policy"
grep -Fq "object.metadata.annotations.size() == 1" <<<"$policy"
grep -Fq "['activation_requested', 'recovery_requested']" <<<"$policy"
grep -Fq 'object.spec.size() == 2' <<<"$policy"
grep -Fq 'object.spec.warmPoolRef.name in ["developer-pool"]' <<<"$policy"
grep -Fq "object.spec.warmPoolRef.name == {\"developer\":\"developer-pool\"}[object.metadata.labels['opencrane.ai/profile']]" <<<"$policy"
grep -Fq 'envVarsInjectionPolicy: Disallowed' <<<"$template"
grep -Fq 'validationActions: [Deny]' <<<"$binding"
grep -Fq 'immutable: true' <<<"$profile_config"
grep -Fq '\"profileRevisionId\":\"profile-revision-developer-v1\"' <<<"$profile_config"
grep -Fq '\"namespace\":\"opencrane-testv5\"' <<<"$profile_config"
grep -Fq '\"sandboxProfile\":\"developer\"' <<<"$profile_config"
grep -Fq '\"warmPoolName\":\"developer-pool\"' <<<"$profile_config"
grep -Fq 'immutable: true' <<<"$runtime_bootstrap"
grep -Fq 'endpoint: "http://opencrane-testv5-opencrane-server.default.svc.cluster.local:8081/api/internal/conversation-computer/runtime"' <<<"$runtime_bootstrap"
grep -Fq 'protocol-version: "conversation-computer-runtime.v1"' <<<"$runtime_bootstrap"
grep -Fq 'token-audience: "opencrane-conversation-computer-runtime"' <<<"$runtime_bootstrap"
grep -Fq 'OPENCRANE_CONVERSATION_COMPUTER_PROFILE_CONFIG_PATH' <<<"$server_deployment"
grep -Fq '/var/run/opencrane/conversation-computer/profiles.json' <<<"$server_deployment"
grep -Fq 'name: conversation-computer-profiles' <<<"$server_deployment"
grep -Fq 'name: opencrane-testv5-conversation-computer-profiles' <<<"$server_deployment"

if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]:0:2}" --set agentSandbox.enabled=true "${VALUES[@]:4}" >/dev/null 2>&1; then
  echo "Agent Sandbox rendered without a namespace" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.profiles[0].image.digest=latest' >/dev/null 2>&1; then
  echo "Agent Sandbox rendered with a mutable image reference" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.profiles[0].poolName=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >/dev/null 2>&1; then
  echo "Agent Sandbox rendered with an overlong DNS label" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.runtime.protocolVersion=conversation-computer-runtime.v0' >/dev/null 2>&1; then
  echo "Agent Sandbox rendered with an unknown ConversationComputer runtime protocol" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.runtime.tokenAudience=OPENCRANE' >/dev/null 2>&1; then
  echo "Agent Sandbox rendered with an invalid ConversationComputer token audience" >&2
  exit 1
fi

disabled="$(helm template opencrane-testv5 "$CHART_DIR" --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' --show-only templates/app-rollups.yaml)"
if grep -Eq 'kind: (ConfigMap|SandboxTemplate|SandboxWarmPool|ValidatingAdmissionPolicy|ValidatingAdmissionPolicyBinding)' <<<"$disabled"; then
  echo "Disabled Agent Sandbox rendered profile or admission resources" >&2
  exit 1
fi

echo "Agent Sandbox Helm contract: PASS"
