#!/usr/bin/env bash
# =============================================================================
# OpenCrane — per-ClusterTenant SILO deploy profile (S6 / ADR 0002)
#
# A thin profile over the shared install core (k8s-deploy.sh). It installs ONE
# per-ClusterTenant silo — the dedicated stack a single ClusterTenant runs on shared
# nodes: its own operator + channel proxy + LiteLLM + Cognee + opencrane-ui,
# per-CT networking, and one app-owned PostgreSQL server with isolated logical databases
# and credentials for OpenCrane and LiteLLM.
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
#       --postgres-credentials-secret opencrane-postgres-bootstrap \
#       --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
#       --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap \
#       --opencrane-ui-digest sha256:REVIEWED_BROWSER_BUILD_DIGEST \
#       --cognee-digest sha256:REVIEWED_COGNEE_BUILD_DIGEST \
#       --kurrentdb-image-digest sha256:REVIEWED_KURRENTDB_IMAGE_DIGEST \
#       --kurrentdb-tls-secret opencrane-kurrentdb-tls \
#       --kurrentdb-bootstrap-admin-secret opencrane-kurrentdb-bootstrap \
#       --kurrentdb-bootstrap-ops-secret opencrane-kurrentdb-bootstrap-ops \
#       --kurrentdb-service-credential-secret opencrane-kurrentdb-history-service \
#       --kurrentdb-bootstrap-image-repository registry.example/opencrane-kurrentdb-bootstrap \
#       --kurrentdb-bootstrap-image-digest sha256:REVIEWED_KURRENTDB_BOOTSTRAP_IMAGE_DIGEST \
#       --agent-sandbox-image-repository registry.example/opencrane-agent-runtime \
#       --agent-sandbox-image-digest sha256:REVIEWED_AGENT_SANDBOX_IMAGE_DIGEST \
#       [--namespace opencrane-acme] \
#       [ANY k8s-deploy.sh flag]
#
# --base-domain, --cluster-tenant, --acme-email, and --first-user-email are required. The first
# user must sign in with this exact verified OIDC email to claim the standalone silo's first owner.
# The silo is installed into namespace `opencrane-<cluster-tenant>` unless --namespace overrides it.
# Fresh silo deploys require `--opencrane-ui-digest` and `--cognee-digest`. An upgrade may omit
# either only to retain the exact digest already recorded by the release. Tags are accepted only by
# the disposable local k3d smoke.
#
# Prereqs: kubectl, helm, the cluster-wide controllers, and the PostgreSQL credentials
# Secrets already present in the target namespace. testv5 also requires a ready Agent Sandbox
# controller with its extensions; each Sandbox, SandboxClaim, SandboxTemplate, and SandboxWarmPool
# CRD serving and storing v1beta1; the gvisor RuntimeClass; and KurrentDB TLS keys (tls.crt,
# tls.key, ca.crt), administrator and operations password keys, and an `opencrane-history`
# username/password in the named Secrets. It also requires digest-pinned bootstrap and Agent Sandbox profile images.
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
KURRENTDB_IMAGE_DIGEST="${OPENCRANE_KURRENTDB_IMAGE_DIGEST:-}"
KURRENTDB_TLS_SECRET="${OPENCRANE_KURRENTDB_TLS_SECRET:-}"
KURRENTDB_BOOTSTRAP_ADMIN_SECRET="${OPENCRANE_KURRENTDB_BOOTSTRAP_ADMIN_SECRET:-}"
KURRENTDB_BOOTSTRAP_OPS_SECRET="${OPENCRANE_KURRENTDB_BOOTSTRAP_OPS_SECRET:-}"
KURRENTDB_SERVICE_CREDENTIAL_SECRET="${OPENCRANE_KURRENTDB_SERVICE_CREDENTIAL_SECRET:-}"
KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY="${OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY:-}"
KURRENTDB_BOOTSTRAP_IMAGE_DIGEST="${OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_DIGEST:-}"
KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY="${OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY:-}"
KURRENTDB_BOOTSTRAP_CPU_REQUEST="${OPENCRANE_KURRENTDB_BOOTSTRAP_CPU_REQUEST:-}"
KURRENTDB_BOOTSTRAP_MEMORY_REQUEST="${OPENCRANE_KURRENTDB_BOOTSTRAP_MEMORY_REQUEST:-}"
KURRENTDB_BOOTSTRAP_CPU_LIMIT="${OPENCRANE_KURRENTDB_BOOTSTRAP_CPU_LIMIT:-}"
KURRENTDB_BOOTSTRAP_MEMORY_LIMIT="${OPENCRANE_KURRENTDB_BOOTSTRAP_MEMORY_LIMIT:-}"
KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS="${OPENCRANE_KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS:-}"
KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT="${OPENCRANE_KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT:-}"
KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS="${OPENCRANE_KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS:-}"
AGENT_SANDBOX_IMAGE_REPOSITORY="${OPENCRANE_AGENT_SANDBOX_IMAGE_REPOSITORY:-}"
AGENT_SANDBOX_IMAGE_DIGEST="${OPENCRANE_AGENT_SANDBOX_IMAGE_DIGEST:-}"
AGENT_SANDBOX_IMAGE_PULL_POLICY="${OPENCRANE_AGENT_SANDBOX_IMAGE_PULL_POLICY:-}"
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
    --kurrentdb-image-digest) KURRENTDB_IMAGE_DIGEST="$2"; shift 2 ;;
    --kurrentdb-tls-secret) KURRENTDB_TLS_SECRET="$2"; shift 2 ;;
    --kurrentdb-bootstrap-admin-secret) KURRENTDB_BOOTSTRAP_ADMIN_SECRET="$2"; shift 2 ;;
    --kurrentdb-bootstrap-ops-secret) KURRENTDB_BOOTSTRAP_OPS_SECRET="$2"; shift 2 ;;
    --kurrentdb-service-credential-secret) KURRENTDB_SERVICE_CREDENTIAL_SECRET="$2"; shift 2 ;;
    --kurrentdb-bootstrap-image-repository) KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY="$2"; shift 2 ;;
    --kurrentdb-bootstrap-image-digest) KURRENTDB_BOOTSTRAP_IMAGE_DIGEST="$2"; shift 2 ;;
    --kurrentdb-bootstrap-image-pull-policy) KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY="$2"; shift 2 ;;
    --kurrentdb-bootstrap-cpu-request) KURRENTDB_BOOTSTRAP_CPU_REQUEST="$2"; shift 2 ;;
    --kurrentdb-bootstrap-memory-request) KURRENTDB_BOOTSTRAP_MEMORY_REQUEST="$2"; shift 2 ;;
    --kurrentdb-bootstrap-cpu-limit) KURRENTDB_BOOTSTRAP_CPU_LIMIT="$2"; shift 2 ;;
    --kurrentdb-bootstrap-memory-limit) KURRENTDB_BOOTSTRAP_MEMORY_LIMIT="$2"; shift 2 ;;
    --kurrentdb-bootstrap-active-deadline-seconds) KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS="$2"; shift 2 ;;
    --kurrentdb-bootstrap-backoff-limit) KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT="$2"; shift 2 ;;
    --kurrentdb-bootstrap-timeout-seconds) KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS="$2"; shift 2 ;;
    --agent-sandbox-image-repository) AGENT_SANDBOX_IMAGE_REPOSITORY="$2"; shift 2 ;;
    --agent-sandbox-image-digest) AGENT_SANDBOX_IMAGE_DIGEST="$2"; shift 2 ;;
    --agent-sandbox-image-pull-policy) AGENT_SANDBOX_IMAGE_PULL_POLICY="$2"; shift 2 ;;
    --oidc-issuer-url) OIDC_ISSUER_URL="$2"; PASSTHROUGH+=(--oidc-issuer-url "$2"); shift 2 ;;
    --oidc-client-id)  OIDC_CLIENT_ID="$2"; PASSTHROUGH+=(--oidc-client-id "$2"); shift 2 ;;
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
# OpenCrane and LiteLLM logical databases. Default `opencrane-<cluster-tenant>`;
# --namespace overrides.
[[ -n "$NAMESPACE" ]] || NAMESPACE="opencrane-${CLUSTER_TENANT}"
EXPECTED_RELEASE="opencrane-${CLUSTER_TENANT}"
[[ -n "$RELEASE" ]] || RELEASE="$EXPECTED_RELEASE"
[[ "$RELEASE" == "$EXPECTED_RELEASE" ]] || { err "--release must be '$EXPECTED_RELEASE' for ClusterTenant '$CLUSTER_TENANT'."; exit 1; }

if [[ "$CLUSTER_TENANT" == "testv5" ]]; then
  [[ "$KURRENTDB_IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || { err "testv5 requires --kurrentdb-image-digest with an immutable sha256 digest."; exit 1; }
  [[ "$KURRENTDB_TLS_SECRET" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { err "testv5 requires --kurrentdb-tls-secret."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_ADMIN_SECRET" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { err "testv5 requires --kurrentdb-bootstrap-admin-secret."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_OPS_SECRET" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { err "testv5 requires --kurrentdb-bootstrap-ops-secret."; exit 1; }
  [[ "$KURRENTDB_SERVICE_CREDENTIAL_SECRET" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || { err "testv5 requires --kurrentdb-service-credential-secret."; exit 1; }
  [[ -n "$KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY" ]] || { err "testv5 requires --kurrentdb-bootstrap-image-repository for the purpose-built bootstrap image."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || { err "testv5 requires --kurrentdb-bootstrap-image-digest with an immutable sha256 digest."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY" =~ ^(Always|IfNotPresent|Never)$ ]] || { err "testv5 requires --kurrentdb-bootstrap-image-pull-policy (Always, IfNotPresent, or Never)."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_CPU_REQUEST" =~ ^[1-9][0-9]*m?$ ]] || { err "testv5 requires --kurrentdb-bootstrap-cpu-request."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_MEMORY_REQUEST" =~ ^[1-9][0-9]*(Ki|Mi|Gi)$ ]] || { err "testv5 requires --kurrentdb-bootstrap-memory-request."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_CPU_LIMIT" =~ ^[1-9][0-9]*m?$ ]] || { err "testv5 requires --kurrentdb-bootstrap-cpu-limit."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_MEMORY_LIMIT" =~ ^[1-9][0-9]*(Ki|Mi|Gi)$ ]] || { err "testv5 requires --kurrentdb-bootstrap-memory-limit."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS" =~ ^[1-9][0-9]*$ ]] || { err "testv5 requires --kurrentdb-bootstrap-active-deadline-seconds."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT" =~ ^[0-9]+$ ]] || { err "testv5 requires --kurrentdb-bootstrap-backoff-limit."; exit 1; }
  [[ "$KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { err "testv5 requires --kurrentdb-bootstrap-timeout-seconds."; exit 1; }
  [[ -n "$AGENT_SANDBOX_IMAGE_REPOSITORY" ]] || { err "testv5 requires --agent-sandbox-image-repository."; exit 1; }
  [[ "$AGENT_SANDBOX_IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || { err "testv5 requires --agent-sandbox-image-digest with an immutable sha256 digest."; exit 1; }
  [[ "$AGENT_SANDBOX_IMAGE_PULL_POLICY" =~ ^(Always|IfNotPresent|Never)$ ]] || { err "testv5 requires --agent-sandbox-image-pull-policy (Always, IfNotPresent, or Never)."; exit 1; }
  for crd in sandboxes.agents.x-k8s.io sandboxclaims.extensions.agents.x-k8s.io sandboxtemplates.extensions.agents.x-k8s.io sandboxwarmpools.extensions.agents.x-k8s.io; do
    kubectl get crd "$crd" >/dev/null 2>&1 || { err "testv5 requires the Kubernetes Agent Sandbox CRD '$crd'."; exit 1; }
    AGENT_SANDBOX_V1BETA1_STATE="$(kubectl get crd "$crd" -o 'jsonpath={range .spec.versions[?(@.name=="v1beta1")]}{.served}:{.storage}{end}')"
    [[ "$AGENT_SANDBOX_V1BETA1_STATE" == "true:true" ]] || { err "testv5 requires Agent Sandbox CRD '$crd' to serve and store v1beta1 resources."; exit 1; }
  done
  AGENT_SANDBOX_IMAGE="$(kubectl get deployment agent-sandbox-controller --namespace agent-sandbox-system -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)"
  [[ "$AGENT_SANDBOX_IMAGE" == *@sha256:* ]] || { err "testv5 requires the Agent Sandbox controller to use an immutable image digest."; exit 1; }
  AGENT_SANDBOX_ARGS="$(kubectl get deployment agent-sandbox-controller --namespace agent-sandbox-system -o jsonpath='{range .spec.template.spec.containers[0].args[*]}{.}{"\\n"}{end}' 2>/dev/null)"
  grep -Fx -- '--extensions' <<<"$AGENT_SANDBOX_ARGS" >/dev/null || { err "testv5 requires the Agent Sandbox extensions reconciler."; exit 1; }
  kubectl rollout status deployment/agent-sandbox-controller --namespace agent-sandbox-system --timeout=120s >/dev/null || { err "testv5 requires a Ready Agent Sandbox controller."; exit 1; }
  kubectl get sandboxwarmpools.extensions.agents.x-k8s.io --all-namespaces >/dev/null 2>&1 || { err "testv5 requires the Agent Sandbox extensions API to respond."; exit 1; }
  kubectl get runtimeclass gvisor >/dev/null 2>&1 || { err "testv5 requires the approved gvisor RuntimeClass."; exit 1; }
  kubectl get secret "$KURRENTDB_TLS_SECRET" --namespace "$NAMESPACE" >/dev/null 2>&1 || { err "testv5 KurrentDB TLS Secret '$KURRENTDB_TLS_SECRET' does not exist in namespace '$NAMESPACE'."; exit 1; }
  kubectl get secret "$KURRENTDB_BOOTSTRAP_ADMIN_SECRET" --namespace "$NAMESPACE" >/dev/null 2>&1 || { err "testv5 KurrentDB bootstrap Secret '$KURRENTDB_BOOTSTRAP_ADMIN_SECRET' does not exist in namespace '$NAMESPACE'."; exit 1; }
  kubectl get secret "$KURRENTDB_BOOTSTRAP_OPS_SECRET" --namespace "$NAMESPACE" >/dev/null 2>&1 || { err "testv5 KurrentDB bootstrap operations Secret '$KURRENTDB_BOOTSTRAP_OPS_SECRET' does not exist in namespace '$NAMESPACE'."; exit 1; }
  kubectl get secret "$KURRENTDB_SERVICE_CREDENTIAL_SECRET" --namespace "$NAMESPACE" >/dev/null 2>&1 || { err "testv5 KurrentDB service credential Secret '$KURRENTDB_SERVICE_CREDENTIAL_SECRET' does not exist in namespace '$NAMESPACE'."; exit 1; }
  for required_immutable_secret in "$KURRENTDB_TLS_SECRET" "$KURRENTDB_BOOTSTRAP_ADMIN_SECRET" "$KURRENTDB_BOOTSTRAP_OPS_SECRET" "$KURRENTDB_SERVICE_CREDENTIAL_SECRET"; do
    [[ "$(kubectl get secret "$required_immutable_secret" --namespace "$NAMESPACE" -o jsonpath='{.immutable}')" == "true" ]] || { err "testv5 KurrentDB Secret '$required_immutable_secret' must set immutable: true."; exit 1; }
  done
  for required_tls_key in tls.crt tls.key ca.crt; do
    [[ -n "$(kubectl get secret "$KURRENTDB_TLS_SECRET" --namespace "$NAMESPACE" -o "go-template={{ index .data \"$required_tls_key\" }}")" ]] || { err "testv5 KurrentDB TLS Secret '$KURRENTDB_TLS_SECRET' requires key '$required_tls_key'."; exit 1; }
  done
  [[ -n "$(kubectl get secret "$KURRENTDB_BOOTSTRAP_ADMIN_SECRET" --namespace "$NAMESPACE" -o 'go-template={{ index .data "password" }}')" ]] || { err "testv5 KurrentDB bootstrap Secret '$KURRENTDB_BOOTSTRAP_ADMIN_SECRET' requires key 'password'."; exit 1; }
  [[ -n "$(kubectl get secret "$KURRENTDB_BOOTSTRAP_OPS_SECRET" --namespace "$NAMESPACE" -o 'go-template={{ index .data "password" }}')" ]] || { err "testv5 KurrentDB bootstrap operations Secret '$KURRENTDB_BOOTSTRAP_OPS_SECRET' requires key 'password'."; exit 1; }
  for required_service_key in username password; do
    [[ -n "$(kubectl get secret "$KURRENTDB_SERVICE_CREDENTIAL_SECRET" --namespace "$NAMESPACE" -o "go-template={{ index .data \"$required_service_key\" }}")" ]] || { err "testv5 KurrentDB service credential Secret '$KURRENTDB_SERVICE_CREDENTIAL_SECRET' requires key '$required_service_key'."; exit 1; }
  done
  KURRENTDB_SERVICE_USERNAME="$(kubectl get secret "$KURRENTDB_SERVICE_CREDENTIAL_SECRET" --namespace "$NAMESPACE" -o 'jsonpath={.data.username}' | base64 -d)"
  [[ "$KURRENTDB_SERVICE_USERNAME" == "opencrane-history" ]] || { err "testv5 KurrentDB service credential Secret '$KURRENTDB_SERVICE_CREDENTIAL_SECRET' must use username 'opencrane-history'."; exit 1; }
  PASSTHROUGH+=(
    --set "historyStore.kurrentdb.enabled=true"
    --set-string "historyStore.kurrentdb.image.digest=$KURRENTDB_IMAGE_DIGEST"
    --set-string "historyStore.kurrentdb.tls.existingSecret=$KURRENTDB_TLS_SECRET"
    --set-string "historyStore.kurrentdb.bootstrapAdmin.existingSecret=$KURRENTDB_BOOTSTRAP_ADMIN_SECRET"
    --set-string "historyStore.kurrentdb.bootstrapOps.existingSecret=$KURRENTDB_BOOTSTRAP_OPS_SECRET"
    --set-string "historyStore.kurrentdb.serviceCredential.existingSecret=$KURRENTDB_SERVICE_CREDENTIAL_SECRET"
    --set-string "historyStore.kurrentdb.bootstrap.image.repository=$KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY"
    --set-string "historyStore.kurrentdb.bootstrap.image.digest=$KURRENTDB_BOOTSTRAP_IMAGE_DIGEST"
    --set-string "historyStore.kurrentdb.bootstrap.image.pullPolicy=$KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY"
    --set-string "historyStore.kurrentdb.bootstrap.resources.requests.cpu=$KURRENTDB_BOOTSTRAP_CPU_REQUEST"
    --set-string "historyStore.kurrentdb.bootstrap.resources.requests.memory=$KURRENTDB_BOOTSTRAP_MEMORY_REQUEST"
    --set-string "historyStore.kurrentdb.bootstrap.resources.limits.cpu=$KURRENTDB_BOOTSTRAP_CPU_LIMIT"
    --set-string "historyStore.kurrentdb.bootstrap.resources.limits.memory=$KURRENTDB_BOOTSTRAP_MEMORY_LIMIT"
    --set "historyStore.kurrentdb.bootstrap.activeDeadlineSeconds=$KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS"
    --set "historyStore.kurrentdb.bootstrap.backoffLimit=$KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT"
    --set "historyStore.kurrentdb.bootstrap.timeoutSeconds=$KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS"
    --set "agentSandbox.enabled=true"
    --set-string "agentSandbox.namespace=$NAMESPACE"
    --set-string "agentSandbox.runtimeClassName=gvisor"
    --set-string "agentSandbox.serviceAccountName=${RELEASE}-agent-sandbox"
    --set-string "agentSandbox.profiles[0].profileRevisionId=profile-revision-developer-v1"
    --set-string "agentSandbox.profiles[0].agentServiceKinds[0]=personal"
    --set-string "agentSandbox.profiles[0].agentServiceKinds[1]=managed"
    --set-string "agentSandbox.profiles[0].name=developer"
    --set-string "agentSandbox.profiles[0].poolName=developer-pool"
    --set-string "agentSandbox.profiles[0].image.repository=$AGENT_SANDBOX_IMAGE_REPOSITORY"
    --set-string "agentSandbox.profiles[0].image.digest=$AGENT_SANDBOX_IMAGE_DIGEST"
    --set-string "agentSandbox.profiles[0].image.pullPolicy=$AGENT_SANDBOX_IMAGE_PULL_POLICY"
    --set-string "agentSandbox.profiles[0].resources.requests.cpu=100m"
    --set-string "agentSandbox.profiles[0].resources.requests.memory=128Mi"
    --set-string "agentSandbox.profiles[0].resources.limits.cpu=500m"
    --set-string "agentSandbox.profiles[0].resources.limits.memory=512Mi")
fi

# Human APIs are fail-closed without OIDC. Require the exact org client rather than deploying an
# intentionally inaccessible or tokenless development setup.
[[ -n "${OIDC_ISSUER_URL:-}" ]] || { err "OIDC_ISSUER_URL is required."; exit 1; }
[[ -n "${OIDC_CLIENT_ID:-}" ]] || { err "OIDC_CLIENT_ID is required for this ClusterTenant."; exit 1; }
[[ -n "${OIDC_REDIRECT_URI:-}" ]] || export OIDC_REDIRECT_URI="https://${CLUSTER_TENANT}.${BASE_DOMAIN}/api/v1/auth/callback"

# Silo value profile: a per-ClusterTenant install in its own namespace. Shared cluster
# controllers remain external.
PROFILE_SET=(
  --cluster-tenant "$CLUSTER_TENANT"
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
