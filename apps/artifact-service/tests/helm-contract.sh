#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$ROOT_DIR/apps/_infra/deploy-k8s"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

helm dependency build "$CHART" >/dev/null
helm template opencrane "$CHART" >"$OUTPUT"

grep -q 'name: opencrane-artifact-service' "$OUTPUT"
grep -q 'namespace: default-artifacts' "$OUTPUT"
grep -q 'kind: PersistentVolumeClaim' "$OUTPUT"
grep -q 'storage: "20Gi"' "$OUTPUT"
grep -q 'accessModes: \["ReadWriteOnce"\]' "$OUTPUT"
grep -q 'automountServiceAccountToken: false' "$OUTPUT"
grep -q 'mountPath: /var/lib/opencrane/artifacts' "$OUTPUT"
grep -q 'key: lease-public.pem' "$OUTPUT"
grep -q 'key: receipt-private.pem' "$OUTPUT"
grep -q 'key: lease-private.pem' "$OUTPUT"
grep -q 'key: receipt-public.pem' "$OUTPUT"
grep -q 'secretName: "opencrane-artifact-catalog-keys"' "$OUTPUT"
grep -q 'secretName: "opencrane-artifact-service-keys"' "$OUTPUT"
grep -q 'readOnlyRootFilesystem: true' "$OUTPUT"
grep -q 'app.kubernetes.io/component: artifact-service' "$OUTPUT"

ruby -ryaml -e '
documents = YAML.load_stream(File.read(ARGV.fetch(0))).compact
policy = documents.find do |document|
  document.is_a?(Hash) && document["kind"] == "NetworkPolicy" && document.dig("metadata", "name") == "opencrane-artifact-service"
end
abort "artifact service NetworkPolicy must render" unless policy

spec = policy.fetch("spec")
abort "artifact service NetworkPolicy must select only artifact-service pods" unless spec.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "artifact-service"
abort "artifact service NetworkPolicy must enforce ingress and egress" unless spec.fetch("policyTypes").sort == ["Egress", "Ingress"]

server_rule = spec.fetch("ingress").find do |rule|
  rule.fetch("from").any? do |peer|
    peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "default" && peer.dig("podSelector", "matchLabels", "app.kubernetes.io/component") == "opencrane-server"
  end && rule.fetch("ports").map { |port| [port["protocol"], port["port"]] } == [["TCP", 8080]]
end
abort "artifact service NetworkPolicy must admit only the OpenCrane server on TCP 8080" unless server_rule

egress = spec.fetch("egress")
abort "artifact service NetworkPolicy must have explicit egress rules" if egress.empty?
egress.each do |rule|
  peers = rule["to"]
  abort "artifact service NetworkPolicy must not allow broad egress" unless peers.is_a?(Array) && !peers.empty?
  peers.each do |peer|
    abort "artifact service NetworkPolicy egress peers must be namespace and pod selected" unless peer.key?("namespaceSelector") && peer.key?("podSelector")
  end
end

dns_rule = egress.find do |rule|
  rule.fetch("to").any? do |peer|
    peer.dig("namespaceSelector", "matchLabels", "kubernetes.io/metadata.name") == "kube-system" && peer.dig("podSelector", "matchLabels", "k8s-app") == "kube-dns"
  end
end
abort "artifact service NetworkPolicy must permit only selected kube-dns pods for DNS" unless dns_rule
dns_ports = dns_rule.fetch("ports").map { |port| [port["protocol"], port["port"]] }
abort "artifact service NetworkPolicy DNS egress must permit UDP and TCP port 53 only" unless dns_ports.sort == [["TCP", 53], ["UDP", 53]]
' "$OUTPUT"

if grep -A40 'name: opencrane-artifact-service' "$OUTPUT" | grep -qE 'kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)'; then
  echo "artifact service must not receive Kubernetes API permissions" >&2
  exit 1
fi

if grep -q 'name: opencrane-opencrane-server-default' "$OUTPUT"; then
  echo "opencrane server must not retain the legacy cluster-wide RBAC role" >&2
  exit 1
fi

echo "artifact-service Helm contract: PASS"
