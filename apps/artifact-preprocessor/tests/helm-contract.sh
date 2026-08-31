#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
source "$ROOT/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
MANIFEST="$(mktemp)"
prepare_current_chart_sources
trap 'cleanup_current_chart_sources; rm -f "$MANIFEST"' EXIT
CHART_ROOT="$(current_chart_sources_dir)"

render_enabled() {
  helm template oc "$CHART_ROOT" \
    --namespace server-ns \
    --set artifactPreprocessor.enabled=true \
    --set-string artifactPreprocessor.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
    --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
    "$@"
}

render_enabled > "$MANIFEST"

ruby -ryaml -e '
documents = YAML.load_stream(File.read(ARGV.fetch(0))).compact
deployment = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "Deployment" &&
    document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessor"
end
abort "artifact preprocessor must not render an always-on Deployment" if deployment

namespace = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "Namespace" &&
    document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessing"
end
abort "artifact preprocessor namespace must render" unless namespace
labels = namespace.dig("metadata", "labels")
abort "artifact preprocessor namespace must enforce current restricted Pod Security" unless labels["pod-security.kubernetes.io/enforce"] == "restricted" &&
  labels["pod-security.kubernetes.io/enforce-version"] == "latest" &&
  labels["pod-security.kubernetes.io/audit"] == "restricted" &&
  labels["pod-security.kubernetes.io/warn"] == "restricted"

service_account = documents.find do |document|
  document.is_a?(Hash) && document["kind"] == "ServiceAccount" &&
    document.dig("metadata", "name") == "artifact-preprocessor"
end
abort "artifact preprocessor ServiceAccount must render" unless service_account
abort "artifact preprocessor ServiceAccount must live in its dedicated namespace" unless service_account.dig("metadata", "namespace") == "oc-opencrane-artifact-preprocessing"
abort "artifact preprocessor ServiceAccount must disable its default token" unless service_account["automountServiceAccountToken"] == false

policy = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "NetworkPolicy" &&
    document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessor"
end
abort "artifact preprocessor NetworkPolicy must render" unless policy
abort "artifact preprocessor policy must live with the worker" unless policy.dig("metadata", "namespace") == "oc-opencrane-artifact-preprocessing"
spec = policy.fetch("spec")
abort "artifact preprocessor must deny ingress" unless spec.fetch("ingress") == []
abort "artifact preprocessor must own ingress and egress policy" unless spec.fetch("policyTypes").sort == ["Egress", "Ingress"]

egress = spec.fetch("egress")
allowed_peers = [["server-ns", "opencrane-server"], ["kube-system", "kube-dns"], ["server-ns", "otel-collector"]]
egress.each do |rule|
  rule.fetch("to").each do |peer|
    pair = [
      peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name"),
      peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") ||
        peer.dig("podSelector", "matchLabels", "k8s-app")
    ]
    abort "artifact preprocessor must not allow egress to #{pair.inspect}" unless allowed_peers.include?(pair)
  end
end

server_rule = egress.find do |rule|
  rule.fetch("to").any? do |peer|
    peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "server-ns" &&
      peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "opencrane-server"
  end
end
abort "artifact preprocessor must select only OpenCrane as its application peer" unless server_rule
abort "artifact preprocessor server egress must use only TCP 8081" unless server_rule.fetch("ports") == [{ "protocol" => "TCP", "port" => 8081 }]
abort "artifact preprocessor must select cluster DNS" unless egress.any? do |rule|
  rule.fetch("to").any? { |peer| peer.dig("podSelector", "matchLabels", "k8s-app") == "kube-dns" }
end
abort "artifact preprocessor must not have direct ArtifactStore egress" if egress.to_s.include?("artifact-service")

server_policy = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "NetworkPolicy" &&
    document.dig("metadata", "name") == "oc-opencrane-opencrane-server"
end
abort "OpenCrane server NetworkPolicy must render" unless server_policy
server_admission = server_policy.fetch("spec").fetch("ingress").any? do |rule|
  rule.fetch("ports", []).map { |port| [port["protocol"], port["port"]] } == [["TCP", 8081]] &&
    rule.fetch("from").any? do |peer|
      peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "oc-opencrane-artifact-preprocessing" &&
        peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "artifact-preprocessor"
    end
end
abort "OpenCrane server must admit the exact artifact preprocessor label only on its internal port" unless server_admission
server_deployment = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "Deployment" &&
    document.dig("metadata", "name") == "oc-opencrane-opencrane-server"
end
server_environment = server_deployment.dig("spec", "template", "spec", "containers", 0, "env")
server_worker_namespace = server_environment.find { |entry| entry["name"] == "ARTIFACT_PREPROCESSOR_NAMESPACE" }
abort "OpenCrane must receive the exact namespace used for worker TokenReview" unless server_worker_namespace == {
  "name" => "ARTIFACT_PREPROCESSOR_NAMESPACE",
  "value" => "oc-opencrane-artifact-preprocessing"
}

artifact_policy = documents.find do |document|
  document.is_a?(Hash) &&
    document["kind"] == "NetworkPolicy" &&
    document.dig("metadata", "name") == "oc-opencrane-artifact-service"
end
abort "artifact-service NetworkPolicy must render" unless artifact_policy
abort "artifact-service must not admit the brokered artifact preprocessor" if artifact_policy.fetch("spec").fetch("ingress").to_s.include?("artifact-preprocessor")

forbidden_kinds = ["Deployment", "Service", "PersistentVolumeClaim", "Secret", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"]
residue = documents.select do |document|
  document.is_a?(Hash) &&
    forbidden_kinds.include?(document["kind"]) &&
    document.dig("metadata", "name").to_s.include?("artifact-preprocessor")
end
abort "artifact preprocessor rendered listener, persistence, key, or RBAC residue: #{residue}" unless residue.empty?
' "$MANIFEST"

if render_enabled --set-string artifactPreprocessor.image.digest=latest >/dev/null 2>&1; then
  echo "artifact preprocessor accepted a mutable image reference" >&2
  exit 1
fi

if render_enabled --set-string artifactPreprocessor.namespace=server-ns >/dev/null 2>&1; then
  echo "artifact preprocessor accepted the trusted server namespace" >&2
  exit 1
fi

if render_enabled --set-string artifactPreprocessor.namespace=INVALID_NAMESPACE >/dev/null 2>&1; then
  echo "artifact preprocessor accepted an invalid namespace" >&2
  exit 1
fi

echo "artifact-preprocessor Helm contract: PASS"
