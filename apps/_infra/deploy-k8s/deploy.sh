#!/usr/bin/env bash
# =============================================================================
# OpenCrane — per-ClusterTenant SILO deploy profile (S6 / ADR 0002)
#
# A thin profile over the shared install core (k8s-deploy.sh). It installs ONE
# per-ClusterTenant silo — the dedicated stack a single ClusterTenant runs on shared
# nodes: its own operator + channel proxy + Obot + LiteLLM + Cognee + opencrane-ui,
# per-CT networking, and one app-owned PostgreSQL server with isolated logical databases
# and credentials for OpenCrane, Obot, and LiteLLM.
#
# The CLUSTER-WIDE infrastructure (ingress controller, CloudNativePG, cert-manager) is an
# external prerequisite. A silo never installs these shared controllers. It creates only
# its namespaced app releases and requires one pre-created PostgreSQL basic-auth credentials
# Secret for each logical database.
#
# Usage:
#   apps/_infra/deploy-k8s/deploy.sh \
#       --base-domain dev.opencrane.ai \
#       --cluster-tenant acme \
#       --acme-email operator@example.com \
#       --first-user-email owner@example.com \
#       --initial-model-provider openai \
#       # OPENCRANE_INITIAL_MODEL_API_KEY is required in the environment \
#       --postgres-credentials-secret opencrane-postgres-bootstrap \
#       --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
#       --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
#       --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap \
#       --opencrane-ui-digest sha256:REVIEWED_BROWSER_BUILD_DIGEST \
#       --cognee-digest sha256:REVIEWED_COGNEE_BUILD_DIGEST \
#       [--namespace opencrane-acme] \
#       [ANY k8s-deploy.sh flag]
#
# --base-domain, --cluster-tenant, --acme-email, and --first-user-email are required. The first
# user must sign in with this exact verified OIDC email to claim the standalone silo's first owner.
# `--initial-model-provider` plus
# OPENCRANE_INITIAL_MODEL_API_KEY seed the first routable model through LiteLLM. The silo is installed into namespace
# `opencrane-<cluster-tenant>` unless --namespace overrides it.
# Fresh silo deploys require `--opencrane-ui-digest` and `--cognee-digest`. An upgrade may omit
# either only to retain the exact digest already recorded by the release. Tags are accepted only by
# the disposable local k3d smoke.
#
# Prereqs: kubectl, helm, the cluster-wide controllers, and the PostgreSQL credentials
# Secrets already present in the target namespace.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The release-specific wrapper and its platform engine have one deployment owner.
CORE="$SCRIPT_DIR/platform/k8s-deploy.sh"
export OPENCRANE_CHART_DIR="$SCRIPT_DIR"

CLUSTER_TENANT=""
NAMESPACE=""
RELEASE=""
BASE_DOMAIN="${OPENCRANE_BASE_DOMAIN:-}"
ACME_EMAIL="${OPENCRANE_ACME_EMAIL:-}"
FIRST_USER_EMAIL="${OPENCRANE_FIRST_USER_EMAIL:-}"
PASSTHROUGH=()

err() { echo -e "\033[0;31m[silo]\033[0m $1" >&2; }

# Parse only the profile-specific flags; everything else is forwarded verbatim to the core.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-tenant)  CLUSTER_TENANT="$2"; shift 2 ;;
    --namespace)       NAMESPACE="$2"; shift 2 ;;
    --release)         RELEASE="$2"; shift 2 ;;
    --base-domain)     BASE_DOMAIN="$2"; PASSTHROUGH+=(--base-domain "$2"); shift 2 ;;
    --acme-email)      ACME_EMAIL="$2"; shift 2 ;;
    --first-user-email) FIRST_USER_EMAIL="$2"; PASSTHROUGH+=(--first-user-email "$2"); shift 2 ;;
    --oidc-issuer-url) OIDC_ISSUER_URL="$2"; PASSTHROUGH+=(--oidc-issuer-url "$2"); shift 2 ;;
    --oidc-client-id)  OIDC_CLIENT_ID="$2"; PASSTHROUGH+=(--oidc-client-id "$2"); shift 2 ;;
    --initial-model-provider) PASSTHROUGH+=(--initial-model-provider "$2"); shift 2 ;;
    -h|--help)         grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                 PASSTHROUGH+=("$1"); shift ;;
  esac
done

[[ -n "$BASE_DOMAIN" ]]     || { err "--base-domain is required (the platform wildcard base this silo is served under)."; exit 1; }
[[ -n "$CLUSTER_TENANT" ]]  || { err "--cluster-tenant is required (the ClusterTenant this silo serves)."; exit 1; }
[[ -n "$ACME_EMAIL" ]]      || { err "--acme-email is required to issue a browser-trusted certificate for this public silo host."; exit 1; }
[[ -n "$FIRST_USER_EMAIL" ]] || { err "--first-user-email is required to claim this standalone silo's first owner from a verified OIDC login."; exit 1; }

# Fail fast if the external CloudNativePG prerequisite is absent.
command -v kubectl >/dev/null 2>&1 || { err "kubectl not found."; exit 1; }
if ! kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  err "CloudNativePG operator not found (CRD clusters.postgresql.cnpg.io absent). Install it as a cluster prerequisite before OpenCrane."
  exit 1
fi
if ! kubectl get crd certificates.cert-manager.io >/dev/null 2>&1; then
  err "cert-manager not found (CRD certificates.cert-manager.io absent). Install it as a cluster prerequisite before OpenCrane."
  exit 1
fi

# The silo lives in its own namespace so its per-CT DB + planes are isolated from every other
# silo and from the central release. One CNPG Cluster in that namespace hosts its isolated
# OpenCrane, Obot, and LiteLLM logical databases. Default `opencrane-<cluster-tenant>`;
# --namespace overrides.
[[ -n "$NAMESPACE" ]] || NAMESPACE="opencrane-${CLUSTER_TENANT}"
EXPECTED_RELEASE="opencrane-${CLUSTER_TENANT}"
[[ -n "$RELEASE" ]] || RELEASE="$EXPECTED_RELEASE"
[[ "$RELEASE" == "$EXPECTED_RELEASE" ]] || { err "--release must be '$EXPECTED_RELEASE' for ClusterTenant '$CLUSTER_TENANT'."; exit 1; }

# Human APIs are fail-closed without OIDC. Require the exact org client rather than deploying an
# intentionally inaccessible or tokenless development setup.
[[ -n "${OIDC_ISSUER_URL:-}" ]] || { err "OIDC_ISSUER_URL is required."; exit 1; }
[[ -n "${OIDC_CLIENT_ID:-}" ]] || { err "OIDC_CLIENT_ID is required for this ClusterTenant."; exit 1; }
[[ -n "${OIDC_REDIRECT_URI:-}" ]] || export OIDC_REDIRECT_URI="https://${CLUSTER_TENANT}.${BASE_DOMAIN}/api/v1/auth/callback"

# Silo value profile: a per-ClusterTenant install in its own namespace. Shared cluster
# controllers remain external.
PROFILE_SET=(
  --namespace "$NAMESPACE"
  --release "$RELEASE"
  --set "multiInstance.enabled=false"
  # Same-origin org hosting is the chart's only mode.
  --set "ingress.tls.enabled=true"
  # Issue the ClusterTenant boundary's TLS certificate through its release-owned namespaced Issuer.
  --set "certManager.enabled=true"
  # A public ClusterTenant host is complete only with a browser-trusted certificate.
  # A distinct Issuer name makes an upgrade from the old self-signed profile reissue.
  --set "certManager.mode=acme"
  --set "certManager.issuerName=opencrane-acme-issuer"
  --set "certManager.acme.email=${ACME_EMAIL}"
  # The server is served at the ClusterTenant host `<cluster-tenant>.<base>`.
  --set "ingress.controlPlaneHost=${CLUSTER_TENANT}.${BASE_DOMAIN}"
  # First-owner admission stays a release-local, non-secret contract; durable ownership is
  # created later from verified OIDC callback evidence, never from Helm data.
  --set-string "clustertenantManager.firstUser.clusterTenant=${CLUSTER_TENANT}"
)
echo -e "\033[0;32m[silo]\033[0m Profile: silo for ClusterTenant '$CLUSTER_TENANT' in namespace '$NAMESPACE' on $BASE_DOMAIN"
exec "$CORE" "${PROFILE_SET[@]}" "${PASSTHROUGH[@]}"
