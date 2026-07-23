#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CHART="${OPENCRANE_HELM_CHART_ROOT:-$ROOT/apps/_infra/deploy-k8s}"
MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

helm dependency build "$CHART" >/dev/null
helm template oc "$CHART" --namespace server-ns \
  --set artifactPreprocessor.enabled=true \
  --set-string artifactPreprocessor.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$MANIFEST"

ruby -ryaml -e '
documents = YAML.load_stream(File.read(ARGV.fetch(0))).compact
deployment = documents.find { |document| document.is_a?(Hash) && document["kind"] == "Deployment" && document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessor" }
abort "artifact preprocessor Deployment must render" unless deployment
pod = deployment.fetch("spec").fetch("template").fetch("spec")
abort "artifact preprocessor must use its fixed ServiceAccount" unless pod["serviceAccountName"] == "artifact-preprocessor"
abort "artifact preprocessor must disable default API token mount" unless pod["automountServiceAccountToken"] == false
abort "artifact preprocessor must have only token and bounded scratch volumes" unless pod.fetch("volumes").map { |volume| volume.fetch("name") }.sort == ["opencrane-token", "scratch"]
abort "artifact preprocessor must use only emptyDir scratch" unless pod.fetch("volumes").find { |volume| volume.fetch("name") == "scratch" }.key?("emptyDir")
abort "artifact preprocessor must mount no persistent ArtifactStore root" if pod.to_s.include?("/var/lib/opencrane/artifacts")
container = pod.fetch("containers").fetch(0)
abort "artifact preprocessor must be read-only" unless container.dig("securityContext", "readOnlyRootFilesystem") == true
token = pod.fetch("volumes").find { |volume| volume.fetch("name") == "opencrane-token" }.dig("projected", "sources", 0, "serviceAccountToken")
abort "artifact preprocessor token must have the exact audience" unless token.fetch("audience") == "opencrane-artifact-preprocessor"
policy = documents.find { |document| document.is_a?(Hash) && document["kind"] == "NetworkPolicy" && document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessor" }
abort "artifact preprocessor NetworkPolicy must render" unless policy
spec = policy.fetch("spec")
abort "artifact preprocessor must deny ingress" unless spec.fetch("ingress") == []
abort "artifact preprocessor must own ingress and egress policy" unless spec.fetch("policyTypes").sort == ["Egress", "Ingress"]
egress = spec.fetch("egress")
allowed_peers = [["server-ns", "opencrane-server"], ["server-ns-artifacts", "artifact-service"], ["kube-system", "kube-dns"], ["server-ns", "otel-collector"]]
egress.each do |rule|
  rule.fetch("to").each do |peer|
    pair = [peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name"), peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") || peer.dig("podSelector", "matchLabels", "k8s-app")]
    abort "artifact preprocessor must not allow an unselected egress peer" unless allowed_peers.include?(pair)
  end
end
abort "artifact preprocessor must select the server" unless egress.any? { |rule| rule.fetch("to").any? { |peer| peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "opencrane-server" } }
abort "artifact preprocessor must select ArtifactStore" unless egress.any? { |rule| rule.fetch("to").any? { |peer| peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "artifact-service" } }
abort "artifact preprocessor must select cluster DNS" unless egress.any? { |rule| rule.fetch("to").any? { |peer| peer.dig("podSelector", "matchLabels", "k8s-app") == "kube-dns" } }
server_policy = documents.find { |document| document.is_a?(Hash) && document["kind"] == "NetworkPolicy" && document.dig("metadata", "name") == "oc-opencrane-opencrane-server" }
abort "OpenCrane server NetworkPolicy must render" unless server_policy
server_admission = server_policy.fetch("spec").fetch("ingress").any? do |rule|
  rule.fetch("from").any? do |peer|
    peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "server-ns" && peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "artifact-preprocessor"
  end
end
abort "OpenCrane server must admit only the exact artifact preprocessor label to its internal port" unless server_admission
artifact_policy = documents.find { |document| document.is_a?(Hash) && document["kind"] == "NetworkPolicy" && document.dig("metadata", "name") == "oc-opencrane-artifact-service" }
abort "artifact-service NetworkPolicy must render" unless artifact_policy
artifact_admission = artifact_policy.fetch("spec").fetch("ingress").any? do |rule|
  rule.fetch("from").any? do |peer|
    peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "server-ns" && peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "artifact-preprocessor"
  end
end
abort "artifact-service must admit only the exact artifact preprocessor label" unless artifact_admission
service = documents.find { |document| document.is_a?(Hash) && document["kind"] == "Service" && document.dig("metadata", "name") == "oc-opencrane-artifact-preprocessor" }
abort "artifact preprocessor must not expose a Service" if service
rbac = documents.any? { |document| document.is_a?(Hash) && ["Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"].include?(document["kind"]) && document.dig("metadata", "name").to_s.include?("artifact-preprocessor") }
abort "artifact preprocessor must not receive Kubernetes RBAC" if rbac
' "$MANIFEST"

if helm template oc "$CHART" --namespace server-ns --set artifactPreprocessor.enabled=true --set-string artifactPreprocessor.image.digest=latest >/dev/null 2>&1; then
  echo "artifact preprocessor accepted a mutable image reference" >&2
  exit 1
fi

echo "artifact-preprocessor Helm contract: PASS"
