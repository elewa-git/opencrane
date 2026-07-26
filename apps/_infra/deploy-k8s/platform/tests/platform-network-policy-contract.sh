#!/usr/bin/env bash
# Ensures the platform default-deny admits database traffic only through the
# CNPG-managed PgBouncer Pooler destination.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
OUTPUT="$(mktemp)"
MULTI_OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT" "$MULTI_OUTPUT"' EXIT

helm template opencrane-silo "$ROOT_DIR/apps/_infra/deploy-k8s" \
  --set networkPolicy.mainNetworkDefaultDeny.enabled=true \
  --set-string networkPolicy.postgresPoolerName=opencrane-postgres-restored-pooler >"$OUTPUT"

PLATFORM_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: opencrane-silo-platform-default-deny/ { print }
' "$OUTPUT")"

test -n "$PLATFORM_POLICY"
grep -Fq '        values: [artifact-service, agent-controller, agent-runtime]' <<<"$PLATFORM_POLICY"
grep -Fq '      - key: cnpg.io/poolerName' <<<"$PLATFORM_POLICY"
grep -Fq '        operator: DoesNotExist' <<<"$PLATFORM_POLICY"
grep -Fq '              cnpg.io/poolerName: opencrane-postgres-restored-pooler' <<<"$PLATFORM_POLICY"
grep -Fq '          port: 5432' <<<"$PLATFORM_POLICY"

if grep -Fq 'cnpg.io/cluster' <<<"$PLATFORM_POLICY"; then
  echo "Platform workloads must use the Pooler, never direct CNPG instance pods." >&2
  exit 1
fi

helm template oc-acme "$ROOT_DIR/apps/_infra/deploy-k8s" \
  --namespace oc-acme \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/multi-instance/oc-acme.yaml" \
  >"$MULTI_OUTPUT"

CROSS_INSTANCE_POLICY="$(awk '
  BEGIN { RS="---" }
  /kind: NetworkPolicy/ && /name: .*cross-instance-deny/ { print }
' "$MULTI_OUTPUT")"

test -n "$CROSS_INSTANCE_POLICY"
grep -Fq '              cnpg.io/poolerName: oc-acme-postgres-pooler' <"$MULTI_OUTPUT"
grep -Fq '        values: [artifact-service, agent-controller, agent-runtime]' <<<"$CROSS_INSTANCE_POLICY"
grep -Fq '      - key: cnpg.io/poolerName' <<<"$CROSS_INSTANCE_POLICY"
grep -Fq '        operator: DoesNotExist' <<<"$CROSS_INSTANCE_POLICY"

echo "platform network policy contract: PASS"
