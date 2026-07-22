#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

rendered="$(helm template opencrane-silo "$CHART_DIR" \
  --set-string networkPolicy.postgresPoolerName=opencrane-postgres-restored-pooler)"
server_policy="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if (is_policy && is_server_policy) {
      printf "%s", document
    }
    document = ""
    is_policy = 0
    is_server_policy = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: NetworkPolicy$/ {
    is_policy = 1
  }
  /^  name: opencrane-silo-opencrane-server$/ {
    is_server_policy = 1
  }
  END {
    flush_document()
  }
')"

[[ -n "$server_policy" ]]
grep -Fq '              cnpg.io/poolerName: opencrane-postgres-restored-pooler' <<<"$server_policy"
grep -Fq '          port: 5432' <<<"$server_policy"
grep -Fq '          port: 443' <<<"$server_policy"
grep -Fq '              kubernetes.io/metadata.name: kube-system' <<<"$server_policy"
grep -Fq '              k8s-app: kube-dns' <<<"$server_policy"
grep -Fq '          port: 53' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: litellm' <<<"$server_policy"
grep -Fq '          port: 4000' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: cognee' <<<"$server_policy"
grep -Fq '          port: 8000' <<<"$server_policy"
grep -Fq '              app.kubernetes.io/component: tenant' <<<"$server_policy"
grep -Fq '          port: 18789' <<<"$server_policy"

if grep -Fq '              app.kubernetes.io/component: mcp-gateway' <<<"$server_policy"; then
  echo "opencrane-server policy grants unused MCP gateway egress" >&2
  exit 1
fi

if grep -Fq 'cnpg.io/cluster' <<<"$server_policy"; then
  echo "opencrane-server policy bypasses the PostgreSQL pooler" >&2
  exit 1
fi

gcp_policy="$(helm template opencrane-silo "$CHART_DIR" --set hosting.provider=gcp)"
grep -Fq '            cidr: 169.254.169.254/32' <<<"$gcp_policy"

langfuse_render="$(helm template opencrane-silo "$CHART_DIR" --set langfuse.inCluster.enabled=true)"
grep -Fq 'value: "http://opencrane-silo-langfuse-web.default.svc.cluster.local:3000"' <<<"$langfuse_render"
grep -Fq '              app.kubernetes.io/name: langfuse' <<<"$langfuse_render"
grep -Fq '              app: web' <<<"$langfuse_render"
grep -Fq '          port: 3000' <<<"$langfuse_render"

echo "opencrane-server network policy contract: PASS"
