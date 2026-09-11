#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap cleanup_current_chart_sources EXIT
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"

VALUES=(
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
  --set agentSandbox.enabled=true
  --set-string agentSandbox.namespace=opencrane-testv5
  --set-string agentSandbox.runtimeClassName=gvisor
  --set-string agentSandbox.serviceAccountName=agent-sandbox-runtime
  --set-string 'agentSandbox.profiles[0].name=developer'
  --set-string 'agentSandbox.profiles[0].poolName=developer-pool'
  --set 'agentSandbox.profiles[0].warmReplicas=0'
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
grep -Fq '            - name: OPENCRANE_COMPUTER_REALIZATION_KIND' <<<"$template"
grep -Fq '              value: agent_sandbox' <<<"$template"
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
grep -Fq '            - name: review-credential' <<<"$template"
grep -Fq '              mountPath: /var/run/opencrane/review' <<<"$template"
grep -Fq '            medium: Memory' <<<"$template"
# gVisor includes emptyDir volume names in annotation keys, whose name portion must fit 63 bytes.
# @see https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/#syntax-and-character-set
SANDBOX_RENDERED_TEMPLATE="$template" node <<'NODE'
const assert = require("node:assert/strict");
const YAML = require("yaml");
const profile = YAML.parse(process.env.SANDBOX_RENDERED_TEMPLATE).spec;
const pod = profile.podTemplate.spec;
assert.equal(profile.networkPolicyManagement, "Unmanaged",
  "The release NetworkPolicy must be the sole owner of computer network access");
assert.equal(pod.dnsPolicy, "ClusterFirst", "The computer must resolve its private server");
assert.equal(pod.dnsConfig, undefined, "The controller must not inject public DNS resolvers");
const reviewMount = pod.containers.find(container => container.name === "conversation-computer")
  .volumeMounts.find(mount => mount.mountPath === "/var/run/opencrane/review");
assert.ok(reviewMount, "The review credential directory must stay mounted");
const reviewVolume = pod.volumes.find(volume => volume.name === reviewMount.name);
assert.deepEqual(reviewVolume?.emptyDir, { medium: "Memory", sizeLimit: "1Mi" },
  "The review credential must remain on the matching memory-backed volume");
const emptyDirs = pod.volumes.filter(volume => volume.emptyDir !== undefined);
assert.ok(emptyDirs.length > 0, "The rendered profile must contain its ephemeral volumes");
for (const volume of emptyDirs) {
  for (const suffix of ["options", "share", "type"]) {
    const annotationName = `dev.gvisor.spec.mount.${volume.name}.${suffix}`;
    assert.ok(Buffer.byteLength(annotationName, "utf8") <= 63,
      `Generated gVisor annotation name exceeds 63 bytes: ${annotationName}`);
  }
}
NODE
# The release policy must select the actual template and retain only its fixed service paths.
SANDBOX_RENDERED="$rendered" node <<'NODE'
const assert = require("node:assert/strict");
const YAML = require("yaml");
const resources = YAML.parseAllDocuments(process.env.SANDBOX_RENDERED).map(document => document.toJSON());
const template = resources.find(resource => resource?.kind === "SandboxTemplate");
const policy = resources.find(resource => resource?.kind === "NetworkPolicy" && resource.metadata.name === "opencrane-testv5-conversation-computer");
assert.ok(policy);
for (const [label, value] of Object.entries(policy.spec.podSelector.matchLabels)) {
  assert.equal(template.spec.podTemplate.metadata.labels[label], value);
}
assert.deepEqual(policy.spec.policyTypes, ["Ingress", "Egress"]);
assert.deepEqual(policy.spec.ingress.map(rule => rule.ports.map(port => port.port)), [[8090]]);
assert.deepEqual(policy.spec.egress.map(rule => rule.ports.map(port => port.port)), [[8081], [53, 53]]);
for (const rule of [...policy.spec.ingress, ...policy.spec.egress]) {
  for (const peer of rule.from ?? rule.to ?? []) assert.equal(peer.ipBlock, undefined);
}
NODE
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
grep -Fq 'replicas: 0' <<<"$pool"
grep -Fq 'sandboxTemplateRef:' <<<"$pool"
grep -Fq 'name: opencrane-testv5-developer-template' <<<"$pool"
grep -Fq 'apiGroups: ["extensions.agents.x-k8s.io"]' <<<"$role"
grep -Fq 'resources: ["sandboxclaims"]' <<<"$role"
grep -Fq 'verbs: ["create", "get", "patch", "delete"]' <<<"$role"
if grep -Eq '"(list|watch|update)"' <<<"$role"; then
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
grep -Fq "k in variables.controllerAnnotations" <<<"$policy"
grep -Fq "['activation_requested', 'recovery_requested']" <<<"$policy"
grep -Fq '!has(object.spec.env) && !has(object.spec.volumeClaimTemplates)' <<<"$policy"
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

# Values files and --set must both accept zero and reject idle prewarming.
NUMERIC_VALUES=()
for ((index=0; index<${#VALUES[@]}; index++)); do
  if [[ "${VALUES[$index]}" == "--set" && "${VALUES[$((index + 1))]}" == 'agentSandbox.profiles[0].warmReplicas=0' ]]; then
    index=$((index + 1))
    continue
  fi
  NUMERIC_VALUES+=("${VALUES[$index]}")
done
numeric_profile="$CHART_DIR/numeric-profile-test.yaml"
for replicas in 0 0.0; do
  printf 'agentSandbox:\n  profiles:\n    - warmReplicas: %s\n' "$replicas" >"$numeric_profile"
  numeric_rendered="$(helm template opencrane-testv5 "$CHART_DIR" --values "$numeric_profile" "${NUMERIC_VALUES[@]}" --show-only templates/app-rollups.yaml)"
  numeric_pool="$(awk 'BEGIN { RS="---" } /kind: SandboxWarmPool/ { print }' <<<"$numeric_rendered")"
  grep -Fq "replicas: ${replicas%.*}" <<<"$numeric_pool"
done
for replicas in '"0"' 0.5 true -1 1 10 null; do
  printf 'agentSandbox:\n  profiles:\n    - warmReplicas: %s\n' "$replicas" >"$numeric_profile"
  if helm template opencrane-testv5 "$CHART_DIR" --values "$numeric_profile" "${NUMERIC_VALUES[@]}" >/dev/null 2>&1; then
    echo "Agent Sandbox accepted invalid YAML warmReplicas: $replicas" >&2
    exit 1
  fi
done
if helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set-string 'agentSandbox.profiles[0].warmReplicas=0' >/dev/null 2>&1; then
  echo "Agent Sandbox accepted a string warmReplicas through --set-string" >&2
  exit 1
fi

disabled="$(helm template opencrane-testv5 "$CHART_DIR" --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' --show-only templates/app-rollups.yaml)"
if grep -Eq 'kind: (SandboxTemplate|SandboxWarmPool|ValidatingAdmissionPolicy|ValidatingAdmissionPolicyBinding)' <<<"$disabled"; then
  echo "Disabled Agent Sandbox rendered profile or admission resources" >&2
  exit 1
fi

# The model service must retain server and Cognee access while denying computer Pods.
# Render these two owners in the disposable chart so unrelated memory requirements do not mask
# LiteLLM's own policy switch when the broad policy and agent controller are disabled.
printf '{{ include "opencrane.litellm.networkPolicy" . }}\n---\n{{ include "opencrane.agentSandbox.resources" . }}\n' >"$CHART_DIR/templates/app-rollups.yaml"
isolated="$(helm template opencrane-testv5 "$CHART_DIR" "${VALUES[@]}" --set networkPolicy.enabled=false --set agentController.enabled=false --set-string agentSandbox.namespace=isolated-computers --set litellm.service.port=4100 --show-only templates/app-rollups.yaml)"
SANDBOX_RENDERED="$rendered" SANDBOX_DISABLED="$disabled" SANDBOX_ISOLATED="$isolated" node <<'NODE'
const assert = require("node:assert/strict");
const YAML = require("yaml");
for (const [input, namespace, port] of [[process.env.SANDBOX_RENDERED, "opencrane-testv5", 4000], [process.env.SANDBOX_ISOLATED, "isolated-computers", 4100], [process.env.SANDBOX_DISABLED, null, 4000]]) {
  const resources = YAML.parseAllDocuments(input).map(document => document.toJSON()).filter(Boolean);
  const claimRoleName = "opencrane-testv5-agent-sandbox-claims";
  const claimRoles = resources.filter(resource => ["Role", "ClusterRole"].includes(resource.kind) && resource.metadata.name === claimRoleName);
  const claimBindings = resources.filter(resource => ["RoleBinding", "ClusterRoleBinding"].includes(resource.kind) && resource.metadata.name === claimRoleName);
  assert.equal(claimRoles.length, namespace === null ? 0 : 1);
  assert.equal(claimBindings.length, namespace === null ? 0 : 1);
  if (namespace !== null) {
    const [role] = claimRoles;
    assert.equal(role.kind, "Role");
    assert.equal(role.metadata.namespace, namespace);
    assert.deepEqual(role.rules, [
      { apiGroups: ["extensions.agents.x-k8s.io"], resources: ["sandboxclaims"], verbs: ["create", "get", "patch", "delete"] },
      { apiGroups: ["agents.x-k8s.io"], resources: ["sandboxes"], verbs: ["get"] },
      { apiGroups: [""], resources: ["pods"], verbs: ["get"] }
    ]);
    const [binding] = claimBindings;
    assert.equal(binding.kind, "RoleBinding");
    assert.equal(binding.metadata.namespace, namespace);
    assert.deepEqual(binding.subjects, [{ kind: "ServiceAccount", name: "opencrane-testv5-opencrane-server", namespace: "default" }]);
    assert.deepEqual(binding.roleRef, { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: claimRoleName });
  }
  // Evaluate every rendered binding, including group grants, to catch rights from another role.
  const allowsPod = (accountNamespace, accountName, targetNamespace, verb) => {
    const username = `system:serviceaccount:${accountNamespace}:${accountName}`;
    const groups = ["system:authenticated", "system:serviceaccounts", `system:serviceaccounts:${accountNamespace}`];
    return resources.filter(binding => ["RoleBinding", "ClusterRoleBinding"].includes(binding.kind)).some(binding => {
      if (binding.kind === "RoleBinding" && (binding.metadata.namespace ?? "default") !== targetNamespace) return false;
      const matchesSubject = (binding.subjects ?? []).some(subject =>
        subject.kind === "ServiceAccount" && subject.namespace === accountNamespace && subject.name === accountName ||
        subject.kind === "User" && subject.name === username || subject.kind === "Group" && groups.includes(subject.name));
      if (!matchesSubject) return false;
      const role = resources.find(resource => resource.kind === binding.roleRef.kind && resource.metadata.name === binding.roleRef.name &&
        (resource.kind === "ClusterRole" || (resource.metadata.namespace ?? "default") === (binding.metadata.namespace ?? "default")));
      return (role?.rules ?? []).some(rule =>
        rule.apiGroups?.some(group => group === "" || group === "*") &&
        rule.resources?.some(resource => resource === "pods" || resource === "*") &&
        rule.verbs?.some(candidate => candidate === verb || candidate === "*"));
    });
  };
  for (const targetNamespace of [namespace ?? "opencrane-testv5", "foreign-computers"]) {
    for (const verb of ["get", "list", "watch", "create", "update", "patch", "delete", "deletecollection"]) {
      assert.equal(allowsPod("default", "opencrane-testv5-opencrane-server", targetNamespace, verb),
        namespace !== null && targetNamespace === namespace && verb === "get",
        `Unexpected server Pod permission: ${verb} in ${targetNamespace}`);
      assert.equal(allowsPod(namespace ?? "opencrane-testv5", "agent-sandbox-runtime", targetNamespace, verb), false,
        `The runtime must not receive Pod permission: ${verb} in ${targetNamespace}`);
      assert.equal(allowsPod("foreign-server", "opencrane-testv5-opencrane-server", targetNamespace, verb), false,
        `A foreign server must not receive Pod permission: ${verb} in ${targetNamespace}`);
    }
  }
  const policy = resources.find(resource => resource.kind === "NetworkPolicy" && resource.metadata.name === "opencrane-testv5-litellm");
  assert.ok(policy, "Computer isolation must not depend on the broad network-policy switch");
  const peers = policy.spec.ingress.flatMap(rule => {
    assert.deepEqual(rule.ports, [{ protocol: "TCP", port }]);
    return rule.from;
  });
  assert.deepEqual(peers, ["opencrane-server", "cognee"].map(component => ({
    namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "default" } },
    podSelector: { matchLabels: { ...policy.spec.podSelector.matchLabels, "app.kubernetes.io/component": component } }
  })));
  const accepts = (candidateNamespace, labels) => peers.some(peer =>
    candidateNamespace === peer.namespaceSelector.matchLabels["kubernetes.io/metadata.name"] &&
    Object.entries(peer.podSelector.matchLabels).every(([key, value]) => labels[key] === value));
  for (const peer of peers) {
    assert.ok(accepts("default", peer.podSelector.matchLabels));
    assert.ok(!accepts("foreign-server", peer.podSelector.matchLabels));
    assert.ok(!accepts("default", { ...peer.podSelector.matchLabels, "app.kubernetes.io/instance": "foreign-release" }));
  }
  for (const candidateNamespace of ["default", namespace ?? "opencrane-testv5", "foreign-computers"]) {
    assert.ok(!accepts(candidateNamespace, {
      ...policy.spec.podSelector.matchLabels,
      "app.kubernetes.io/component": "agent-sandbox",
      "opencrane.ai/agent-sandbox-profile": "developer"
    }), "Computer Pods must not reach LiteLLM, including when they share the server namespace");
  }
  assert.ok(!resources.some(resource => resource.metadata?.name === "opencrane-testv5-conversation-computer-egress"), "The server must not duplicate the computer policy");
  if (namespace === null) continue;
  const outbound = resources.find(resource => resource.kind === "NetworkPolicy" && resource.metadata.name === "opencrane-testv5-conversation-computer");
  const modelRule = outbound.spec.egress.find(rule => rule.to?.some(destination => destination.podSelector?.matchLabels?.["app.kubernetes.io/component"] === "litellm"));
  assert.equal(modelRule, undefined);
  assert.deepEqual(outbound.spec.egress.map(rule => rule.ports.map(entry => entry.port)), [[8081], [53, 53]]);
  assert.deepEqual(outbound.spec.egress[0].to, [peers[0]]);
}
NODE

echo "Agent Sandbox Helm contract: PASS"
