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
  --set-string 'agentSandbox.profiles[0].name=developer'
  --set-string 'agentSandbox.profiles[0].poolName=developer-pool'
  --set 'agentSandbox.profiles[0].warmReplicas=1'
  --set-string 'agentSandbox.profiles[0].image.repository=registry.invalid/opencrane-conversation-computer'
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
server="$(awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-testv5-opencrane-server/ { print }' <<<"$rendered")"

[[ -n "$template" && -n "$pool" && -n "$role" && -n "$policy" && -n "$binding" && -n "$server" ]]
grep -Fq 'apiVersion: extensions.agents.x-k8s.io/v1beta1' <<<"$template"
grep -Fq 'image: "registry.invalid/opencrane-conversation-computer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' <<<"$template"
grep -Fq '        - name: conversation-computer' <<<"$template"
grep -Fq '            - name: OPENCRANE_COMPUTER_ID' <<<"$template"
grep -Fq "fieldPath: metadata.labels['opencrane.ai/computer-id']" <<<"$template"
grep -Fq '            - name: OPENCRANE_COMPUTER_GENERATION' <<<"$template"
grep -Fq '            - name: OPENCRANE_COMPUTER_LEASE_ID' <<<"$template"
grep -Fq "fieldPath: metadata.labels['opencrane.ai/computer-lease-id']" <<<"$template"
grep -Fq '            - name: OPENCRANE_INTERNAL_ENDPOINT' <<<"$template"
grep -Fq '            - name: OPENCRANE_WORKSPACE_PATH' <<<"$template"
grep -Fq '              value: /workspace' <<<"$template"
grep -Fq '            - name: OPENCRANE_PREVIEW_PORTS' <<<"$template"
grep -Fq '              value: "3000,4173,4200,5173,8000"' <<<"$template"
grep -Fq '            - name: OPENCRANE_REVIEW_CREDENTIAL_PATH' <<<"$template"
grep -Fq '              value: /var/run/opencrane/review/credential' <<<"$template"
grep -Fq '            - name: opencrane-conversation-review-credential' <<<"$template"
grep -Fq '              mountPath: /var/run/opencrane/review' <<<"$template"
grep -Fq '            medium: Memory' <<<"$template"
grep -Fq '            - name: opencrane-conversation-workspace' <<<"$template"
grep -Fq '          emptyDir:' <<<"$template"
grep -Fq '            sizeLimit: 2Gi' <<<"$template"
grep -Fq '  service: true' <<<"$template"
grep -Fq '            - name: review' <<<"$template"
grep -Fq '              containerPort: 8090' <<<"$template"
grep -Fq '              path: /readyz' <<<"$template"
grep -Fq '              path: /healthz' <<<"$template"
grep -Fq 'runtimeClassName: gvisor' <<<"$template"
grep -Fq 'serviceAccountName: agent-sandbox-runtime' <<<"$template"
grep -Fq 'automountServiceAccountToken: false' <<<"$template"
grep -Fq 'enableServiceLinks: false' <<<"$template"
grep -Fq 'readOnlyRootFilesystem: true' <<<"$template"
grep -Fq 'drop: ["ALL"]' <<<"$template"
grep -Fq 'envVarsInjectionPolicy: Disallowed' <<<"$template"
grep -Fq 'volumeClaimTemplatesPolicy: Disallowed' <<<"$template"
grep -Fq 'replicas: 1' <<<"$pool"
grep -Fq 'sandboxTemplateRef:' <<<"$pool"
grep -Fq 'name: opencrane-testv5-developer-template' <<<"$pool"
grep -Fq 'apiGroups: ["extensions.agents.x-k8s.io"]' <<<"$role"
grep -Fq 'resources: ["sandboxclaims"]' <<<"$role"
grep -Fq 'verbs: ["create", "get", "delete"]' <<<"$role"
if grep -Eq '"(list|watch|patch|update)"' <<<"$role"; then
  echo "Agent Sandbox server Role is broader than deterministic claim lifecycle" >&2
  exit 1
fi
grep -Fq 'apiVersions: ["v1beta1"]' <<<"$policy"
grep -Fq 'resources: ["sandboxclaims"]' <<<"$policy"
grep -Fq 'excludeResourceRules:' <<<"$policy"
grep -Fq 'resources: ["sandboxclaims/status"]' <<<"$policy"
grep -Fq "request.operation == 'CREATE'" <<<"$policy"
grep -Fq "object.metadata.labels.size() == 5" <<<"$policy"
grep -Fq "'opencrane.ai/computer-lease-id'" <<<"$policy"
grep -Fq "object.metadata.annotations.size() == 1" <<<"$policy"
grep -Fq "['activation_requested', 'recovery_requested']" <<<"$policy"
grep -Fq 'object.spec.size() == 3' <<<"$policy"
grep -Fq 'object.spec.additionalPodMetadata.labels.size() == 3' <<<"$policy"
grep -Fq "object.spec.additionalPodMetadata.labels['opencrane.ai/computer-id'] == object.metadata.labels['opencrane.ai/computer-id']" <<<"$policy"
grep -Fq "object.spec.additionalPodMetadata.labels['opencrane.ai/computer-generation'] == object.metadata.labels['opencrane.ai/computer-generation']" <<<"$policy"
grep -Fq "object.spec.additionalPodMetadata.labels['opencrane.ai/computer-lease-id'] == object.metadata.labels['opencrane.ai/computer-lease-id']" <<<"$policy"
grep -Fq 'object.spec.additionalPodMetadata.annotations.size() == 0' <<<"$policy"
grep -Fq 'object.spec.warmPoolRef.name in ["developer-pool"]' <<<"$policy"
grep -Fq "object.spec.warmPoolRef.name == {\"developer\":\"developer-pool\"}[object.metadata.labels['opencrane.ai/profile']]" <<<"$policy"
grep -Fq 'envVarsInjectionPolicy: Disallowed' <<<"$template"
grep -Fq 'validationActions: [Deny]' <<<"$binding"
grep -Fq '            - name: OPENCRANE_COMPUTER_PROFILE_REVISION_ID' <<<"$server"
grep -Fq '              value: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' <<<"$server"
grep -Fq '            - name: OPENCRANE_COMPUTER_PROFILE_NAME' <<<"$server"
grep -Fq '            - name: OPENCRANE_COMPUTER_WARM_POOL_NAME' <<<"$server"
grep -Fq '            - name: OPENCRANE_COMPUTER_NAMESPACE' <<<"$server"
grep -Fq '            - name: OPENCRANE_COMPUTER_SERVICE_ACCOUNT_NAME' <<<"$server"
grep -Fq '              value: "agent-sandbox-runtime"' <<<"$server"
grep -Fq '            - name: OPENCRANE_COMPUTER_LEASE_TTL_SECONDS' <<<"$server"

if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]:0:2}" --set agentSandbox.enabled=true "${VALUES[@]:4}" >/dev/null 2>&1; then
  echo "Agent Sandbox rendered without a namespace" >&2
  exit 1
fi
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.profiles[0].image.digest=latest' >/dev/null 2>&1; then
  echo "Agent Sandbox rendered with a mutable image reference" >&2
  exit 1
fi

disabled="$(helm template opencrane-testv5 "$CHART_DIR" --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' --show-only templates/app-rollups.yaml)"
if grep -Eq 'kind: (SandboxTemplate|SandboxWarmPool|ValidatingAdmissionPolicy|ValidatingAdmissionPolicyBinding)' <<<"$disabled"; then
  echo "Disabled Agent Sandbox rendered profile or admission resources" >&2
  exit 1
fi

echo "Agent Sandbox Helm contract: PASS"
