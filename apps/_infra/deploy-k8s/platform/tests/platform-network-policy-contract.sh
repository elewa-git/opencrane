#!/usr/bin/env bash
# Ensures the platform default-deny admits database traffic only through the
# CNPG-managed PgBouncer Pooler destination.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')
OUTPUT="$(mktemp)"
MULTI_OUTPUT="$(mktemp)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap 'cleanup_current_chart_sources; rm -f "$OUTPUT" "$MULTI_OUTPUT"' EXIT
CHART_DIR="$(current_chart_sources_dir)"

helm template opencrane-silo "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set networkPolicy.mainNetworkDefaultDeny.enabled=true \
  --set-string networkPolicy.postgresPoolerName=opencrane-postgres-restored-pooler >"$OUTPUT"

PLATFORM_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: opencrane-silo-platform-default-deny/ { print }
' "$OUTPUT")"
COGNEE_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: opencrane-silo-cognee-ingress/ { print }
' "$OUTPUT")"
COGNEE_DEPLOYMENT="$(awk '
  BEGIN { RS="---" }
  /kind: Deployment/ && /name: opencrane-silo-cognee/ { print }
' "$OUTPUT")"
MEMORY_GATEWAY_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: opencrane-silo-memory-gateway/ { print }
' "$OUTPUT")"
MEMORY_GATEWAY_DEPLOYMENT="$(awk '
  BEGIN { RS="---" }
  /kind: Deployment/ && /name: opencrane-silo-memory-gateway/ { print }
' "$OUTPUT")"

test -n "$PLATFORM_POLICY"
grep -Fq '        values: [artifact-service, agent-controller, agent-runtime, cognee, memory-gateway]' <<<"$PLATFORM_POLICY"
grep -Fq '      - key: cnpg.io/poolerName' <<<"$PLATFORM_POLICY"
grep -Fq '        operator: DoesNotExist' <<<"$PLATFORM_POLICY"
grep -Fq '              cnpg.io/poolerName: opencrane-postgres-restored-pooler' <<<"$PLATFORM_POLICY"
grep -Fq '          port: 5432' <<<"$PLATFORM_POLICY"

if grep -Fq 'cnpg.io/cluster' <<<"$PLATFORM_POLICY"; then
  echo "Platform workloads must use the Pooler, never direct CNPG instance pods." >&2
  exit 1
fi

# Cognee's app-owned policy must override the generic platform policy with one ingress caller and
# named egress paths. The generic policy excludes Cognee so it cannot widen this list.
test -n "$COGNEE_POLICY"
test -n "$COGNEE_DEPLOYMENT"
awk '/- name: ENABLE_BACKEND_ACCESS_CONTROL/ { getline; if ($0 !~ /value: "false"/) exit 1; found=1 } END { exit !found }' <<<"$COGNEE_DEPLOYMENT"
awk '/- name: REQUIRE_AUTHENTICATION/ { getline; if ($0 !~ /value: "false"/) exit 1; found=1 } END { exit !found }' <<<"$COGNEE_DEPLOYMENT"
grep -Fq '    - Ingress' <<<"$COGNEE_POLICY"
grep -Fq '    - Egress' <<<"$COGNEE_POLICY"
grep -Fq '              app.kubernetes.io/component: memory-gateway' <<<"$COGNEE_POLICY"
grep -Fq '              app.kubernetes.io/component: litellm' <<<"$COGNEE_POLICY"
grep -Fq '              kubernetes.io/metadata.name: kube-system' <<<"$COGNEE_POLICY"
grep -Fq '          port: 4000' <<<"$COGNEE_POLICY"
grep -Fq '          port: 53' <<<"$COGNEE_POLICY"

# The gateway's TokenReview credential is group-readable only by its fixed non-root identity, and
# its API egress is bound to the supplied Service and endpoint addresses rather than broad HTTPS.
test -n "$MEMORY_GATEWAY_POLICY"
test -n "$MEMORY_GATEWAY_DEPLOYMENT"
grep -Fq '        runAsUser: 1000' <<<"$MEMORY_GATEWAY_DEPLOYMENT"
grep -Fq '        runAsGroup: 1000' <<<"$MEMORY_GATEWAY_DEPLOYMENT"
grep -Fq '        fsGroup: 1000' <<<"$MEMORY_GATEWAY_DEPLOYMENT"
grep -Fq '            cidr: "10.43.0.1/32"' <<<"$MEMORY_GATEWAY_POLICY"
grep -Fq '            cidr: "172.18.0.2/32"' <<<"$MEMORY_GATEWAY_POLICY"
grep -Fq '              app.kubernetes.io/component: cognee' <<<"$MEMORY_GATEWAY_POLICY"

if helm template opencrane-shared-litellm "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set sharedPlatform.litellm.mode=shared \
  --set-string sharedPlatform.litellm.shared.endpoint=http://litellm.shared.svc:4000 >/dev/null 2>&1; then
  echo "private Cognee must reject a shared LiteLLM endpoint that its NetworkPolicy cannot name" >&2
  exit 1
fi

if helm template opencrane-without-private-memory-policy "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set networkPolicy.enabled=false >/dev/null 2>&1; then
  echo "private Cognee must reject a render without its network boundary" >&2
  exit 1
fi

helm template oc-acme "$CHART_DIR" \
  "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --namespace oc-acme \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/multi-instance/oc-acme.yaml" \
  >"$MULTI_OUTPUT"

CROSS_INSTANCE_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: .*cross-instance-deny/ { print }
' "$MULTI_OUTPUT")"

test -n "$CROSS_INSTANCE_POLICY"
# PostgreSQL is a separately installed Helm release, so the umbrella render cannot contain a
# CNPG Pooler Pod. The single-instance render above asserts the platform's actual pooler egress.
grep -Fq '        values: [artifact-service, agent-controller, agent-runtime, cognee, memory-gateway]' <<<"$CROSS_INSTANCE_POLICY"
grep -Fq '      - key: cnpg.io/poolerName' <<<"$CROSS_INSTANCE_POLICY"
grep -Fq '        operator: DoesNotExist' <<<"$CROSS_INSTANCE_POLICY"

echo "platform network policy contract: PASS"
