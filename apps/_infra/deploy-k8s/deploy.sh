#!/usr/bin/env bash
# =============================================================================
# OpenCrane — per-ClusterTenant SILO deploy profile (S6 / ADR 0002)
#
# A thin profile over the shared install core (k8s-deploy.sh). It installs ONE
# per-ClusterTenant silo — the dedicated stack a single ClusterTenant runs on shared
# nodes: its own operator + channel proxy + Obot + LiteLLM + Cognee + opencrane-ui,
# per-CT networking, and separate app-owned PostgreSQL releases for OpenCrane,
# Obot, and DB-backed LiteLLM, with self-service
# manager/billing OFF.
#
# The CLUSTER-WIDE infra (ingress-nginx, external-dns, CloudNativePG, cert-manager) is an
# external prerequisite. A silo never installs these shared controllers. It creates only
# its namespaced app releases and requires a pre-created PostgreSQL credentials Secret.
#
# The self-service ClusterTenant manager + billing are OFF (a silo serves exactly one
# ClusterTenant; the fleet is managed by the central super-admin opencrane-ui).
#
# Usage:
#   apps/_infra/deploy-k8s/deploy.sh \
#       --base-domain dev.opencrane.ai \
#       --cluster-tenant acme \
#       --postgres-credentials-secret opencrane-postgres-bootstrap \
#       [--namespace opencrane-acme] [--ingress-ip 34.1.2.3] \
#       [ANY k8s-deploy.sh flag]
#
# --base-domain and --cluster-tenant are required. The silo is installed into namespace
# `opencrane-<cluster-tenant>` unless --namespace overrides it. When --ingress-ip is
# omitted the core auto-derives it from the cluster-wide ingress-nginx LoadBalancer.
#
# Prereqs: kubectl, helm, the cluster-wide controllers, and the PostgreSQL credentials
# Secret already present in the target namespace.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The release-specific wrapper and its platform engine have one deployment owner.
CORE="$SCRIPT_DIR/platform/k8s-deploy.sh"
export OPENCRANE_CHART_DIR="$SCRIPT_DIR"

CLUSTER_TENANT=""
NAMESPACE=""
INGRESS_IP=""
BASE_DOMAIN="${OPENCRANE_BASE_DOMAIN:-}"
PASSTHROUGH=()

err() { echo -e "\033[0;31m[silo]\033[0m $1" >&2; }

# Parse only the profile-specific flags; everything else is forwarded verbatim to the core.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-tenant)  CLUSTER_TENANT="$2"; shift 2 ;;
    --namespace)       NAMESPACE="$2"; shift 2 ;;
    --ingress-ip)      INGRESS_IP="$2"; shift 2 ;;
    --base-domain)     BASE_DOMAIN="$2"; PASSTHROUGH+=(--base-domain "$2"); shift 2 ;;
    -h|--help)         grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                 PASSTHROUGH+=("$1"); shift ;;
  esac
done

[[ -n "$BASE_DOMAIN" ]]     || { err "--base-domain is required (the platform wildcard base this silo is served under)."; exit 1; }
[[ -n "$CLUSTER_TENANT" ]]  || { err "--cluster-tenant is required (the ClusterTenant this silo serves)."; exit 1; }

# Fail fast if the external CloudNativePG prerequisite is absent.
command -v kubectl >/dev/null 2>&1 || { err "kubectl not found."; exit 1; }
if ! kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  err "CloudNativePG operator not found (CRD clusters.postgresql.cnpg.io absent). Install it as a cluster prerequisite before OpenCrane."
  exit 1
fi

# The silo lives in its own namespace so its per-CT DB + planes are isolated from every other
# silo and from the central release. Its OpenCrane, Obot, and LiteLLM databases are separate
# CNPG Clusters inside that namespace. Default `opencrane-<cluster-tenant>`; --namespace overrides.
[[ -n "$NAMESPACE" ]] || NAMESPACE="opencrane-${CLUSTER_TENANT}"

# Per-org OIDC (org-admin login). opencrane-server resolves the per-org CLIENT from the
# ClusterTenant CR at runtime, but its BASE OIDC config must be present or login 503s ("OIDC is not
# configured for this opencrane-ui instance"). The shared loader requires ALL of issuer+client+
# redirect+session once ANY is set, else the pod crashloops ("OIDC is partially configured"). So when
# an issuer is given: require this org's client id (from provisionOrg / the ClusterTenant row), and
# DERIVE this silo's callback at the org host when not supplied (the core generates the session
# secret, and forwards these to clustertenantManager.oidc.* via --set-string). Issue #100 item 3.
if [[ -n "${OIDC_ISSUER_URL:-}" ]]; then
  [[ -n "${OIDC_CLIENT_ID:-}" ]] || { err "OIDC_ISSUER_URL is set but OIDC_CLIENT_ID is not — a silo's OIDC needs THIS org's Zitadel client id (from provisionOrg / the ClusterTenant row). Set OIDC_CLIENT_ID, or unset OIDC_ISSUER_URL to run token/dev auth."; exit 1; }
  [[ -n "${OIDC_REDIRECT_URI:-}" ]] || export OIDC_REDIRECT_URI="https://${CLUSTER_TENANT}.${BASE_DOMAIN}/api/v1/auth/callback"
fi

# SILO value profile: a per-ClusterTenant install in its own namespace — self-service manager +
# billing OFF, multi-instance OFF. Shared cluster controllers remain external.
PROFILE_SET=(
  --namespace "$NAMESPACE"
  --no-ingress-nginx
  --no-external-dns
  # A silo NEVER runs the cluster-wide fleet-manager — that singleton lives in the fleet install
  # (the fleet-platform chart's deploy.sh, now in the WeOwnAI repo per italanta/opencrane#150).
  # Two fleet-managers would contend over the ClusterTenant CRs + IAM.
  --set "fleetManager.enabled=false"
  --set "fleetManager.clusterTenantApi.enabled=false"
  --set "billing.enabled=false"
  --set "multiInstance.enabled=false"
  # NOTE: same-origin org hosting is now the chart's only mode (the legacy `*.<domain>` wildcard
  # gateway-ingress was removed) — no --set needed here to select it.
  --set "ingress.tls.enabled=true"
  # Issue the silo's OWN TLS cert (the app-owned OpenCrane certificate template) via the cluster-wide
  # ClusterIssuer the central release created. A k8s Ingress can only reference a TLS secret in its
  # OWN namespace, so each silo provisions its cert here rather than borrowing the fleet's wildcard
  # secret. No per-silo Issuer is created — only the Certificate, pointed at certManager.issuerName.
  --set "certManager.enabled=true"
  # The silo's opencrane-server serves at the ORG host
  # `<cluster-tenant>.<base>` — NOT the chart default `platform.<base>`, which is the FLEET's
  # super-admin host (the fleet install). Without this, the silo's opencrane-server Ingress
  # collides with the fleet's at platform.<base>. A caller --set later overrides this default.
  --set "ingress.controlPlaneHost=${CLUSTER_TENANT}.${BASE_DOMAIN}"
)
# Pin the cluster ingress IP when given; otherwise derive it from the cluster-wide ingress-nginx
# LoadBalancer (installed by the central release) so the silo's per-org hosts resolve.
if [[ -n "$INGRESS_IP" ]]; then
  PROFILE_SET+=(--set "ingress.externalIp=$INGRESS_IP")
else
  PROFILE_SET+=(--auto-ingress-ip)
fi

echo -e "\033[0;32m[silo]\033[0m Profile: silo for ClusterTenant '$CLUSTER_TENANT' in namespace '$NAMESPACE' on $BASE_DOMAIN"
exec "$CORE" "${PROFILE_SET[@]}" "${PASSTHROUGH[@]}"
