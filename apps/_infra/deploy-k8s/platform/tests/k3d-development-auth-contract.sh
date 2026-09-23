#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"
MEMORY_GATEWAY_API_ARGS=(--set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')

default_rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}")"
if grep -Eq 'OPENCRANE_(DEVELOPMENT_AUTHENTICATION|K3D_DEVELOPMENT)|development-session' <<<"$default_rendered"; then
  echo "ordinary releases rendered the k3d development authentication seam" >&2
  exit 1
fi

ordinary_oidc_rendered="$(helm template opencrane-silo "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set-string clustertenantManager.oidc.issuerUrl=https://issuer.example.test)"
ordinary_membership_issuer="$(grep -A 1 '            - name: OPENCRANE_MEMBERSHIP_TRUSTED_IDENTITY_ISSUER' <<<"$ordinary_oidc_rendered")"
grep -Fq '              value: "https://issuer.example.test"' <<<"$ordinary_membership_issuer"

development_rendered="$(helm template opencrane-tier3 "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set-string clustertenantManager.firstUser.email=developer@example.test \
  --set-string clustertenantManager.firstUser.clusterTenant=opencrane-tier3 \
  --set-string clustertenantManager.developmentAuthentication.mode=k3d \
  --set-string clustertenantManager.developmentAuthentication.publicHost=opencrane-tier3.local.opencrane.test \
  --set-string clustertenantManager.developmentAuthentication.existingSecret=opencrane-tier3-development-session)"
server_manifest="$(printf '%s\n' "$development_rendered" | awk '
  BEGIN { RS="---" }
  $0 ~ /\nkind: Deployment\n/ && $0 ~ /\n  name: opencrane-tier3-opencrane-server\n/ { print $0 }
')"

[[ -n "$server_manifest" ]]
grep -Fq '            - name: OPENCRANE_DEVELOPMENT_AUTHENTICATION' <<<"$server_manifest"
grep -Fq '              value: k3d' <<<"$server_manifest"
grep -Fq '            - name: OPENCRANE_K3D_DEVELOPMENT_HOST' <<<"$server_manifest"
grep -Fq '              value: "opencrane-tier3.local.opencrane.test"' <<<"$server_manifest"
grep -Fq '            - name: OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL_PATH' <<<"$server_manifest"
grep -Fq '              value: /var/run/opencrane/development-session/credential' <<<"$server_manifest"
membership_issuer="$(grep -A 1 '            - name: OPENCRANE_MEMBERSHIP_TRUSTED_IDENTITY_ISSUER' <<<"$server_manifest")"
grep -Fq '              value: https://identity.local.opencrane.test' <<<"$membership_issuer"
grep -Fq '              mountPath: /var/run/opencrane/development-session' <<<"$server_manifest"
development_volume="$(grep -A 8 '        - name: development-session' <<<"$server_manifest")"
grep -Fq '            secretName: "opencrane-tier3-development-session"' <<<"$development_volume"
grep -Fq '            defaultMode: 0440' <<<"$development_volume"
grep -Fq '              - key: "credential"' <<<"$development_volume"
if grep -Fq 'OIDC_ISSUER_URL' <<<"$server_manifest"; then
  echo "k3d development authentication rendered OIDC beside its fixed local identity" >&2
  exit 1
fi

if helm template opencrane-tier3 "$CHART_DIR" "${MEMORY_GATEWAY_API_ARGS[@]}" \
  --set-string clustertenantManager.firstUser.email=developer@example.test \
  --set-string clustertenantManager.firstUser.clusterTenant=opencrane-tier3 \
  --set-string clustertenantManager.developmentAuthentication.mode=k3d \
  --set-string clustertenantManager.developmentAuthentication.publicHost=opencrane-tier3.local.opencrane.test \
  --set-string clustertenantManager.developmentAuthentication.existingSecret=opencrane-tier3-development-session \
  --set-string clustertenantManager.oidc.issuerUrl=https://issuer.example.test >/dev/null 2>&1; then
  echo "k3d development authentication rendered beside OIDC" >&2
  exit 1
fi

echo "k3d development authentication contract: PASS"
