#!/usr/bin/env bash
# =============================================================================
# OpenCrane — install onto ANY Kubernetes cluster
#
# Installs OpenCrane onto the cluster your current kubectl context points at:
# the app-owned PostgreSQL chart (including clean target baseline) → the OpenCrane Helm chart.
# Uses the published ghcr.io/opencrane images and the cluster's
# default StorageClass — pure, provider-agnostic Kubernetes.
#
# This is the shared core. the deploy scripts' --provision (provision.sh) provisions a cluster
# and then call this script.
#
# Usage (normally invoked via a profile — the fleet-platform chart's deploy.sh (now in the
# WeOwnAI repo, elewa-git/opencrane#150) or apps/_infra/deploy-k8s/deploy.sh — which preset
# the value flags and exec this core):
#   apps/_infra/deploy-k8s/platform/k8s-deploy.sh [--base-domain DOMAIN] [--namespace NS] [--release NAME]
#                            [--image-tag TAG] [--storage-class SC]
#                            [--opencrane-server-tag TAG]
#                            [--registry-pull-secret NAME --registry-pull-config-file FILE]
#                            [--oidc-issuer-url URL] [--oidc-client-id ID]
#                            [--oidc-redirect-uri URI] [--oidc-client-secret SECRET]
#                            [--oidc-session-secret SECRET]
#                            [--platform-operator-seed-email EMAIL]
#                            [--platform-operator-groups CSV]
#                            [--first-user-email EMAIL]
#                            [--initial-model-provider PROVIDER]
#                            [--preflight] [--multi-ct] [--verify] [--verify-insecure]
#                            --postgres-credentials-secret NAME
#                            [--postgres-owner OWNER]
#                            --obot-postgres-credentials-secret NAME [--obot-postgres-owner OWNER]
#                            --litellm-postgres-credentials-secret NAME [--litellm-postgres-owner OWNER]
#                            --postgres-admin-credentials-secret NAME [--postgres-admin-name NAME]
#                            [--postgres-values FILE]
#                            [--values FILE] [--set k=v ...] [--helm-arg ARG ...]
#                            [--reuse-values | --reset-values]
#
# Value preservation: on an UPGRADE (release already exists) this engine defaults to Helm's
# --reset-then-reuse-values, so prior --set/-f overrides are NOT silently dropped when a run
# restates fewer values (a component-tag bump preserves the rest). Pass --reuse-values to
# inherit the last release verbatim without refreshing chart defaults, or --reset-values to
# intentionally drop prior overrides and start from chart defaults + this run's flags.
#
# Image-tag float guard: after a prior release's --reset-then-reuse-values upgrade, component
# images may be pinned to a specific tag (e.g. sha-5036a0a). If this invocation does not restate
# that tag (no --opencrane-server-tag) and does not explicitly float
# (OPENCRANE_ALLOW_TAG_FLOAT=1), the script detects the prior pin, warns loudly, and
# automatically re-pins from the last release so pinned tags float silently (a live gotcha from
# 2026-07-12 deploy). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to intentionally float tags to chart-default.
#
# Raw Helm-arg passthrough: --helm-arg ARG (or OPENCRANE_HELM_EXTRA_ARGS='ARG1 ARG2 …')
# appends verbatim arguments to the final helm upgrade invocation. Useful for sanctioned
# one-time fixes like --take-ownership (e.g. when a Certificate loses ownership across versions).
# Repeatable: --helm-arg --take-ownership --helm-arg --force-fields-order.
#
# --base-domain is the platform BASE domain (e.g. dev.opencrane.ai). It is
# a first-class, VALIDATED install input (lowercase FQDN, ≥2 labels) that drives a single
# source of truth: the chart's ingress.domain, the derived controlPlaneHost
# (platform.<base-domain>), and release hosts. Never hardcode a real domain in the repo.
#
# In-chart services:
#   Cognee        — the required release-local graph-RAG service, installed via
#                   clustertenantManager.cognee.install=true. External/BYO Cognee is unsupported.
#
# The platform-operator seed email bootstraps the FIRST platform operator: the
# caller whose VERIFIED OIDC email equals it becomes a platform operator. It is a
# per-cluster INSTALL parameter — DEFAULTS TO EMPTY, which grants operator to
# nobody (fail-closed). Also accepted via the OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL
# env var. Never commit a real owner email into the repo.
#
# `--initial-model-provider` pairs with the required environment-only
# OPENCRANE_INITIAL_MODEL_API_KEY. The installer writes that raw key directly to the release-local
# provider-custody Secret; the server then registers it with LiteLLM's encrypted credentials API
# and seeds the provider model catalogue before it becomes ready. Never pass the API key as a flag.
#
# --image-tag pins the OpenCrane server image. To roll it to a different build,
# pass --opencrane-server-tag (for example, sha-abc123); it overrides --image-tag.
# Always bump component images this way —
# never `kubectl set image` / `kubectl patch` a managed deployment. An imperative
# patch creates a `kubectl-*` field manager that owns the image field on the live
# object and makes every later `helm upgrade` fail with a field-ownership conflict.
#
# Prereqs: kubectl (pointed at the target cluster), helm, externally installed
# CloudNativePG, ingress, and cert-manager controllers, plus pre-created PostgreSQL
# basic-auth Secrets.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POST_DEPLOY_VERIFY="$SCRIPT_DIR/post-deploy-verify.sh"
if [[ ! -f "$POST_DEPLOY_VERIFY" ]]; then
  echo "[k8s-deploy] Post-deploy verifier is missing at '$POST_DEPLOY_VERIFY'." >&2
  exit 1
fi
source "$POST_DEPLOY_VERIFY"
source "$SCRIPT_DIR/kubernetes-api-helm-args.sh"
source "$SCRIPT_DIR/postgres-connection.sh"
source "$SCRIPT_DIR/registry-pull-secret.sh"
source "$SCRIPT_DIR/current-chart-sources.sh"
source "$SCRIPT_DIR/initial-model-provider.sh"
CHART_DIR="${OPENCRANE_CHART_DIR:-}"
if [[ -z "$CHART_DIR" ]]; then
  echo "[k8s-deploy] OPENCRANE_CHART_DIR is unset. Run a role wrapper deploy.sh — the fleet-platform chart's deploy.sh (now in WeOwnAI) or apps/_infra/deploy-k8s/deploy.sh — not k8s-deploy.sh directly." >&2
  exit 1
fi
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"
trap cleanup_current_chart_sources EXIT
POSTGRES_CHART_DIR="${OPENCRANE_POSTGRES_CHART_DIR:-$SCRIPT_DIR/../../../postgres/helm}"
if [[ ! -f "$POSTGRES_CHART_DIR/Chart.yaml" ]]; then
  echo "[k8s-deploy] PostgreSQL chart not found at '$POSTGRES_CHART_DIR'." >&2
  exit 1
fi
POSTGRES_CONNECTION_PUBLISHER="$SCRIPT_DIR/../../../postgres/scripts/publish-app-connection-secret.sh"
if [[ ! -f "$POSTGRES_CONNECTION_PUBLISHER" ]]; then
  echo "[k8s-deploy] PostgreSQL connection Secret publisher is missing at '$POSTGRES_CONNECTION_PUBLISHER'." >&2
  exit 1
fi
POSTGRES_BASELINE_PUBLISHER="$SCRIPT_DIR/../../../postgres/scripts/publish-initdb-baseline-config-map.sh"
POSTGRES_BASELINE_FILE="$SCRIPT_DIR/../../../opencrane/prisma/bootstrap/target-baseline.sql"
if [[ ! -f "$POSTGRES_BASELINE_PUBLISHER" || ! -s "$POSTGRES_BASELINE_FILE" ]]; then
  echo "[k8s-deploy] OpenCrane database baseline publisher or target SQL is missing." >&2
  exit 1
fi
NAMESPACE="opencrane-system"
RELEASE="opencrane"
IMAGE_TAG="latest"
CONTROL_PLANE_TAG=""    # empty → falls back to IMAGE_TAG
REGISTRY_PULL_SECRET=""
REGISTRY_PULL_CONFIG_FILE=""
# --base-domain is the platform BASE domain for this install (e.g. dev.opencrane.ai).
# It drives the chart's ingress.domain and derived release hosts. OPENCRANE_BASE_DOMAIN
# lets the wizard or CI supply it off the command line.
BASE_DOMAIN="${OPENCRANE_BASE_DOMAIN:-}"
STORAGE_CLASS=""        # empty → cluster default StorageClass
ARTIFACT_STORAGE_CLASS="" # resolved class for the durable, expandable ArtifactStore PVC
VALUES_FILE=""
REUSE_VALUES=""      # explicit "--reuse-values": inherit last release's values verbatim; add only overrides
RESET_VALUES=""      # explicit "--reset-values": DROP prior values, start from chart defaults + this run's --set
EXTRA_SET=()
EXTRA_HELM_ARGS=()   # raw --helm-arg passthrough args (e.g. --take-ownership for Certificate ownership recovery)
# OPENCRANE_HELM_EXTRA_ARGS: whitespace-separated raw helm args (env-var form of --helm-arg).
if [[ -n "${OPENCRANE_HELM_EXTRA_ARGS:-}" ]]; then
  read -ra _env_helm_args <<< "$OPENCRANE_HELM_EXTRA_ARGS"
  EXTRA_HELM_ARGS+=("${_env_helm_args[@]}")
fi
ALLOW_TAG_FLOAT="${OPENCRANE_ALLOW_TAG_FLOAT:-0}"  # allow component images to float to chart-default
# OIDC + per-cluster operator bootstrap. All default empty (OIDC stays disabled and the
# seed grants operator to nobody — fail-closed). The seed also accepts an env var so a
# secret manager / CI can supply it without it appearing on the command line.
OIDC_ISSUER_URL="${OIDC_ISSUER_URL:-}"
OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-}"
OIDC_REDIRECT_URI="${OIDC_REDIRECT_URI:-}"
# OIDC client secret (the confidential-client secret from the IdP). Accepted via flag or
# env so it never has to sit in a values file. When OIDC is configured this installer
# CREATES the K8s Secret the chart references (client secret + an auto-generated session
# secret) and wires clustertenantManager.oidc.existingSecret — previously the secret was ASSUMED
# to already exist, so a fresh OIDC install rendered a opencrane-ui that crash-looped on a
# missing Secret. The session secret signs login cookies; we generate one when not supplied.
OIDC_CLIENT_SECRET="${OPENCRANE_OIDC_CLIENT_SECRET:-${OIDC_CLIENT_SECRET:-}}"
OIDC_SESSION_SECRET="${OPENCRANE_OIDC_SESSION_SECRET:-${OIDC_SESSION_SECRET:-}}"
OIDC_SECRET_NAME="opencrane-oidc"
PLATFORM_OPERATOR_SEED_EMAIL="${OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL:-}"
# One verified OIDC email eligible to claim a standalone silo's durable first-owner membership.
# This is separate from platform-operator seeding, which grants broader installation privilege.
FIRST_USER_EMAIL="${OPENCRANE_FIRST_USER_EMAIL:-}"
# Platform-operator GROUP mapping (CSV of IdP groups). OR-ed with the seed email; the
# durable bootstrap once an IdP group exists. Empty → unset (fail-closed).
PLATFORM_OPERATOR_GROUPS="${OPENCRANE_PLATFORM_OPERATOR_GROUPS:-}"
INITIAL_MODEL_PROVIDER="${OPENCRANE_INITIAL_MODEL_PROVIDER:-}"
INITIAL_MODEL_API_KEY="${OPENCRANE_INITIAL_MODEL_API_KEY:-}"
# CloudNativePG is an external cluster prerequisite. OpenCrane never installs or upgrades
# the operator. The credentials Secret is also external: this deploy flow only validates and
# references it, so database passwords never pass through shell generation or repair paths.
POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_POSTGRES_CREDENTIALS_SECRET:-}"
POSTGRES_VALUES_FILE="${OPENCRANE_POSTGRES_VALUES:-}"
POSTGRES_OWNER="${OPENCRANE_POSTGRES_OWNER:-opencrane}"
OBOT_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_OBOT_POSTGRES_CREDENTIALS_SECRET:-}"
OBOT_POSTGRES_OWNER="${OPENCRANE_OBOT_POSTGRES_OWNER:-obot}"
LITELLM_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_LITELLM_POSTGRES_CREDENTIALS_SECRET:-}"
LITELLM_POSTGRES_OWNER="${OPENCRANE_LITELLM_POSTGRES_OWNER:-litellm}"
POSTGRES_ADMIN_CREDENTIALS_SECRET="${OPENCRANE_POSTGRES_ADMIN_CREDENTIALS_SECRET:-}"
POSTGRES_ADMIN_NAME="${OPENCRANE_POSTGRES_ADMIN_NAME:-opencrane_database_admin}"
# --preflight runs a fail-FAST environment check BEFORE any cluster mutation and exits 0/1
# without installing. It catches the failures that otherwise surface as a half-installed,
# crash-looping cluster: no default StorageClass (every PVC pends), a CNI that silently
# ignores NetworkPolicy (the isolation model is a no-op), unpullable first-party images,
# a base domain whose NS delegation does not resolve. Also via
# OPENCRANE_PREFLIGHT=1. It is advisory unless run — the install itself does not auto-run it.
PREFLIGHT="${OPENCRANE_PREFLIGHT:-0}"

# --multi-ct is the EXPLICIT multi-ClusterTenant predicate: this install hosts many orgs
# (ClusterTenants) or many isolated instances in one cluster, so cross-tenant isolation is
# mandatory rather than advisory. It is a deliberate flag (never inferred), so the fail-closed
# checks below can trust it: preflight makes the NetworkPolicy-enforcing-CNI check FATAL (not
# advisory) under multi-CT, and the fleet profile passes it so the fleet-platform chart's
# deploy.sh (now in the WeOwnAI repo, elewa-git/opencrane#150) runs a mandatory preflight.
# Also via OPENCRANE_MULTI_CT=1.
MULTI_CT="${OPENCRANE_MULTI_CT:-0}"

# --verify runs an advisory post-deploy check (pods Running, host resolution, and the public
# /healthz endpoint). Never fails the install. Also via OPENCRANE_VERIFY=1.
VERIFY="${OPENCRANE_VERIFY:-0}"
# --verify-insecure permits only the advisory HTTP check to accept a self-signed certificate.
# It has no effect unless --verify is enabled. Also via OPENCRANE_VERIFY_INSECURE=1.
VERIFY_INSECURE="${OPENCRANE_VERIFY_INSECURE:-0}"

POSTGRES_RELEASE=""
TIMEOUT="${TIMEOUT_SECONDS:-300}"

log()  { echo -e "\033[0;32m[k8s-deploy]\033[0m $1"; }
warn() { echo -e "\033[1;33m[k8s-deploy]\033[0m $1"; }
err()  { echo -e "\033[0;31m[k8s-deploy]\033[0m $1" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-domain)   BASE_DOMAIN="$2"; shift 2 ;;
    --namespace)     NAMESPACE="$2"; shift 2 ;;
    --release)       RELEASE="$2"; shift 2 ;;
    --image-tag)        IMAGE_TAG="$2"; shift 2 ;;
    --opencrane-server-tag) CONTROL_PLANE_TAG="$2"; shift 2 ;;
    --registry-pull-secret) REGISTRY_PULL_SECRET="$2"; shift 2 ;;
    --registry-pull-config-file) REGISTRY_PULL_CONFIG_FILE="$2"; shift 2 ;;
    --storage-class) STORAGE_CLASS="$2"; shift 2 ;;
    --oidc-issuer-url)     OIDC_ISSUER_URL="$2"; shift 2 ;;
    --oidc-client-id)      OIDC_CLIENT_ID="$2"; shift 2 ;;
    --oidc-redirect-uri)   OIDC_REDIRECT_URI="$2"; shift 2 ;;
    --oidc-client-secret)  OIDC_CLIENT_SECRET="$2"; shift 2 ;;
    --oidc-session-secret) OIDC_SESSION_SECRET="$2"; shift 2 ;;
    --platform-operator-seed-email) PLATFORM_OPERATOR_SEED_EMAIL="$2"; shift 2 ;;
    --platform-operator-groups)     PLATFORM_OPERATOR_GROUPS="$2"; shift 2 ;;
    --first-user-email)             FIRST_USER_EMAIL="$2"; shift 2 ;;
    --initial-model-provider)       INITIAL_MODEL_PROVIDER="$2"; shift 2 ;;
    --preflight)        PREFLIGHT="1"; shift ;;
    --multi-ct)         MULTI_CT="1"; shift ;;
    --verify)           VERIFY="1"; shift ;;
    --verify-insecure)  VERIFY_INSECURE="1"; shift ;;
    --postgres-credentials-secret) POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --postgres-owner) POSTGRES_OWNER="$2"; shift 2 ;;
    --obot-postgres-credentials-secret) OBOT_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --obot-postgres-owner) OBOT_POSTGRES_OWNER="$2"; shift 2 ;;
    --litellm-postgres-credentials-secret) LITELLM_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --litellm-postgres-owner) LITELLM_POSTGRES_OWNER="$2"; shift 2 ;;
    --postgres-admin-credentials-secret) POSTGRES_ADMIN_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --postgres-admin-name) POSTGRES_ADMIN_NAME="$2"; shift 2 ;;
    --postgres-values) POSTGRES_VALUES_FILE="$2"; shift 2 ;;
    --values)        VALUES_FILE="$2"; shift 2 ;;
    --reuse-values)  REUSE_VALUES="1"; shift ;;
    --reset-values)  RESET_VALUES="1"; shift ;;
    --set)           EXTRA_SET+=(--set "$2"); shift 2 ;;
    --set-string)    EXTRA_SET+=(--set-string "$2"); shift 2 ;;
    --helm-arg)      EXTRA_HELM_ARGS+=("$2"); shift 2 ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               err "Unknown flag: $1"; exit 1 ;;
  esac
done
for c in kubectl helm; do command -v "$c" >/dev/null 2>&1 || { err "Missing required command: $c"; exit 1; }; done
kubectl cluster-info >/dev/null 2>&1 || { err "kubectl can't reach a cluster. Point your context at the target cluster first."; exit 1; }
# --base-domain validation. When supplied it must be a syntactically valid, lowercase
# FQDN (≥2 labels, no scheme/port/path, no trailing dot) so it can stand in for
# release hosts.
# meaning without it, so acme mode REQUIRES a base domain (fail fast, not a stuck order).
_validate_base_domain() {
  local d="$1"
  if [[ ! "$d" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
    err "Invalid --base-domain '$d'. Expected a lowercase FQDN like 'dev.opencrane.ai' (≥2 labels, no scheme/port/path/trailing dot)."
    exit 1
  fi
}
if [[ -n "$BASE_DOMAIN" ]]; then
  _validate_base_domain "$BASE_DOMAIN"
fi
# --preflight: fail-FAST environment validation, run BEFORE any cluster mutation. Each
# check appends to PF_FAILS; a non-empty list at the end exits 1 with every remediation,
# so the operator fixes the cluster ONCE rather than chasing one half-broken install at a
# time. Read-only against cloud + cluster (never mutates).
_run_preflight() {
  local PF_FAILS=()
  log "Preflight: validating the target environment (no cluster changes will be made)…"

  # 1. Default StorageClass — without one, every PVC (PostgreSQL, tenant storage) pends
  #    forever and the install hangs at "waiting for the database".
  if [[ -z "$STORAGE_CLASS" ]]; then
    if ! kubectl get storageclass -o jsonpath='{range .items[*]}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\n"}{end}' 2>/dev/null | grep -q "true"; then
      PF_FAILS+=("No default StorageClass found. Mark one default (kubectl patch storageclass <name> -p '{\"metadata\":{\"annotations\":{\"storageclass.kubernetes.io/is-default-class\":\"true\"}}}') or pass --storage-class.")
    fi
  else
    kubectl get storageclass "$STORAGE_CLASS" >/dev/null 2>&1 || PF_FAILS+=("--storage-class '$STORAGE_CLASS' does not exist on the cluster.")
  fi

  # 1b. PostgreSQL is app-owned, while its operator and bootstrap credentials are external
  # prerequisites. Validate both without installing, generating, rotating, or repairing them.
  kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1 || PF_FAILS+=("CloudNativePG operator is absent (clusters.postgresql.cnpg.io CRD not found). Install it before OpenCrane.")
  kubectl get crd databases.postgresql.cnpg.io >/dev/null 2>&1 || PF_FAILS+=("CloudNativePG Database CRD is absent (databases.postgresql.cnpg.io not found). Install a compatible operator before OpenCrane.")
  _preflight_postgres_bootstrap() {
    local authority="$1"
    local credentials_secret="$2"
    local database_owner="$3"
    local postgres_key
    local postgres_username
    if [[ -z "$credentials_secret" ]]; then
      PF_FAILS+=("$authority PostgreSQL requires its own pre-created kubernetes.io/basic-auth credentials Secret.")
      return
    elif ! kubectl get secret "$credentials_secret" -n "$NAMESPACE" >/dev/null 2>&1; then
      PF_FAILS+=("$authority PostgreSQL credentials Secret '$credentials_secret' does not exist in namespace '$NAMESPACE'.")
      return
    elif [[ "$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o jsonpath='{.type}')" != "kubernetes.io/basic-auth" ]]; then
      PF_FAILS+=("$authority PostgreSQL credentials Secret '$credentials_secret' must have type kubernetes.io/basic-auth.")
      return
    fi
    for postgres_key in username password; do
      if [[ -z "$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o "jsonpath={.data.${postgres_key}}" 2>/dev/null)" ]]; then
        PF_FAILS+=("$authority PostgreSQL credentials Secret '$credentials_secret' is missing the '$postgres_key' key.")
      fi
    done
    postgres_username="$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o jsonpath='{.data.username}' 2>/dev/null | base64 -d)"
    if [[ "$postgres_username" != "$database_owner" ]]; then
      PF_FAILS+=("$authority PostgreSQL credentials Secret '$credentials_secret' has username '$postgres_username', but database.owner is '$database_owner'.")
    fi
  }
  _preflight_postgres_bootstrap opencrane "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_OWNER"
  _preflight_postgres_bootstrap obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER"
  _preflight_postgres_bootstrap litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER"
  _preflight_postgres_bootstrap database-admin "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_NAME"

  # 2. NetworkPolicy-enforcing CNI — the platform's isolation model is built on
  #    NetworkPolicy; a CNI that silently ignores them (e.g. stock kindnet/flannel) makes
  #    every default-deny a no-op. We probe for a known enforcing CNI DaemonSet. FATAL under
  #    --multi-ct (cross-tenant isolation is mandatory there, so a no-op CNI is a security
  #    hole, not a warning); advisory (warn-and-continue) for a single-CT install where a
  #    non-enforcing CNI only weakens defence-in-depth on a one-org box.
  if ! kubectl get ds -n kube-system -o name 2>/dev/null | grep -qiE "calico|cilium|weave|antrea|kube-router"; then
    if [[ "$MULTI_CT" == "1" ]]; then
      PF_FAILS+=("No NetworkPolicy-enforcing CNI detected (looked for calico/cilium/weave/antrea/kube-router in kube-system). Under --multi-ct the platform's NetworkPolicy isolation is MANDATORY and would be a NO-OP on this CNI — cross-tenant traffic would not be denied. Install an enforcing CNI (GKE: enable Dataplane V2 / network-policy).")
    else
      warn "Preflight: no NetworkPolicy-enforcing CNI detected (calico/cilium/weave/antrea/kube-router). NetworkPolicy isolation will be a no-op; acceptable for a single-tenant box but re-run with --multi-ct if this hosts multiple tenants."
    fi
  fi

  # 3. First-party images pullable — catch a private/typo'd registry before the rollout
  #    sits in ImagePullBackOff. A best-effort manifest check (skopeo/crane/docker) that
  #    only WARNS if no inspector is available (we never block on a missing local tool).
  local _img="ghcr.io/elewa-git/opencrane-server:${CONTROL_PLANE_TAG:-$IMAGE_TAG}"
  if command -v skopeo >/dev/null 2>&1; then
    skopeo inspect "docker://$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (skopeo inspect failed). Check the registry/tag and your pull credentials.")
  elif command -v crane >/dev/null 2>&1; then
    crane manifest "$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (crane manifest failed). Check the registry/tag and your pull credentials.")
  elif command -v docker >/dev/null 2>&1; then
    docker manifest inspect "$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (docker manifest inspect failed). Check the registry/tag and your pull credentials.")
  else
    warn "Preflight: no image inspector (skopeo/crane/docker) — skipping the image-pull check."
  fi

  # 4. DNS authority for --base-domain. The base can be either a delegated zone or a
  #    record subtree served by a parent zone, so an NS RRset on the base itself is not
  #    required. Its SOA lookup must nevertheless reach an authoritative serving zone.
  if [[ -n "$BASE_DOMAIN" ]]; then
    if command -v dig >/dev/null 2>&1; then
      [[ -n "$(dig +noall +authority SOA "$BASE_DOMAIN" 2>/dev/null)" ]] || PF_FAILS+=("No authoritative DNS service resolves for '$BASE_DOMAIN'. Delegate its zone or create the base-domain record under an existing served parent zone.")
    elif command -v host >/dev/null 2>&1; then
      host -t SOA "$BASE_DOMAIN" >/dev/null 2>&1 || PF_FAILS+=("No authoritative DNS service resolves for '$BASE_DOMAIN'. Delegate its zone or create the base-domain record under an existing served parent zone.")
    else
      warn "Preflight: no dig/host — skipping the NS-delegation check for '$BASE_DOMAIN'."
    fi
  fi

  if [[ ${#PF_FAILS[@]} -gt 0 ]]; then
    err "Preflight FAILED — fix these before installing:"
    local i=1
    for f in "${PF_FAILS[@]}"; do err "  $i. $f"; i=$((i+1)); done
    exit 1
  fi
  log "Preflight: all checks passed."
}

if [[ "$PREFLIGHT" == "1" ]]; then
  _run_preflight
  log "Preflight complete (no install performed). Re-run without --preflight to install."
  exit 0
fi

# Canonical artifact bytes are retained indefinitely on a mounted PVC. Pinning the resolved
# class makes the claim stable across default-class changes, and refuses a class that cannot
# grow with a user's retained data.
_require_expandable_artifact_storage() {
  if [[ -n "$STORAGE_CLASS" ]]; then
    ARTIFACT_STORAGE_CLASS="$STORAGE_CLASS"
  else
    ARTIFACT_STORAGE_CLASS="$(kubectl get storageclass -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\n"}{end}' 2>/dev/null | awk '$2 == "true" { selected = $1 } END { print selected }')"
  fi
  if [[ -z "$ARTIFACT_STORAGE_CLASS" ]]; then
    err "ArtifactStore requires a default StorageClass or --storage-class; its canonical mounted volume must be expandable."
    exit 1
  fi
  if [[ "$(kubectl get storageclass "$ARTIFACT_STORAGE_CLASS" -o jsonpath='{.allowVolumeExpansion}' 2>/dev/null)" != "true" ]]; then
    err "ArtifactStore StorageClass '$ARTIFACT_STORAGE_CLASS' does not allow volume expansion. Select a class with allowVolumeExpansion: true."
    exit 1
  fi
}
_require_expandable_artifact_storage

validate_initial_model_provider "$INITIAL_MODEL_PROVIDER" "$INITIAL_MODEL_API_KEY" || exit 1

_gen_secret() { openssl rand -hex 16 2>/dev/null || head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32; }
_read_secret() { kubectl get secret "$1" -n "$NAMESPACE" -o jsonpath="{.data.$2}" 2>/dev/null | base64 -d || true; }
if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  LITELLM_MASTER_KEY="$(_read_secret opencrane-litellm LITELLM_MASTER_KEY)"
  LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-sk-$(_gen_secret)}"
fi
# LiteLLM salt encrypts provider keys stored in the DB (STORE_MODEL_IN_DB). It MUST stay
# constant once set, or already-stored keys become unreadable — so always re-use the
# existing value and only generate a fresh one when the secret has none.
if [[ -z "${LITELLM_SALT_KEY:-}" ]]; then
  LITELLM_SALT_KEY="$(_read_secret opencrane-litellm LITELLM_SALT_KEY)"
  LITELLM_SALT_KEY="${LITELLM_SALT_KEY:-sk-$(_gen_secret)}"
fi

log "Target cluster: $(kubectl config current-context)"
log "Namespace: $NAMESPACE   Release: $RELEASE   Image tag: $IMAGE_TAG"

# 1. Install one app-owned PostgreSQL server for this ClusterTenant. Logical databases
# share its pod/PVC but never credentials: each has its own login role, basic-auth input,
# and published application connection Secret.
if ! kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  err "CloudNativePG is required (clusters.postgresql.cnpg.io is absent). Install the operator before OpenCrane."
  exit 1
fi
if ! kubectl get crd databases.postgresql.cnpg.io >/dev/null 2>&1; then
  err "CloudNativePG Database CRD is required (databases.postgresql.cnpg.io is absent). Install a compatible operator before OpenCrane."
  exit 1
fi
if ! kubectl get crd poolers.postgresql.cnpg.io >/dev/null 2>&1; then
  err "CloudNativePG Pooler CRD is required (poolers.postgresql.cnpg.io is absent). Install a compatible operator before OpenCrane."
  exit 1
fi
_require_postgres_bootstrap() {
  local authority="$1"
  local credentials_secret="$2"
  local database_owner="$3"
  local postgres_key
  local postgres_username
  if [[ -z "$credentials_secret" ]]; then
    err "$authority PostgreSQL requires its own pre-created kubernetes.io/basic-auth credentials Secret."
    exit 1
  fi
  if ! kubectl get secret "$credentials_secret" -n "$NAMESPACE" >/dev/null 2>&1; then
    err "$authority PostgreSQL credentials Secret '$credentials_secret' does not exist in namespace '$NAMESPACE'."
    exit 1
  fi
  if [[ "$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o jsonpath='{.type}')" != "kubernetes.io/basic-auth" ]]; then
    err "$authority PostgreSQL credentials Secret '$credentials_secret' must have type kubernetes.io/basic-auth."
    exit 1
  fi
  for postgres_key in username password; do
    if [[ -z "$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o "jsonpath={.data.${postgres_key}}" 2>/dev/null)" ]]; then
      err "$authority PostgreSQL credentials Secret '$credentials_secret' is missing the '$postgres_key' key."
      exit 1
    fi
  done
  postgres_username="$(kubectl get secret "$credentials_secret" -n "$NAMESPACE" -o jsonpath='{.data.username}' | base64 -d)"
  if [[ "$postgres_username" != "$database_owner" ]]; then
    err "$authority PostgreSQL credentials Secret '$credentials_secret' has username '$postgres_username', but database.owner is '$database_owner'."
    exit 1
  fi
}
_require_postgres_bootstrap opencrane "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_OWNER"
_require_postgres_bootstrap obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER"
_require_postgres_bootstrap litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER"
_require_postgres_bootstrap database-admin "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_NAME"

POSTGRES_RELEASE="${RELEASE}-postgres"
if kubectl get "cluster/$POSTGRES_RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
  POSTGRES_BASELINE_CONFIG_MAP="$(bash "$POSTGRES_BASELINE_PUBLISHER" "$NAMESPACE" "$POSTGRES_OWNER" "$POSTGRES_BASELINE_FILE" --verify-only)"
else
  POSTGRES_BASELINE_CONFIG_MAP="$(bash "$POSTGRES_BASELINE_PUBLISHER" "$NAMESPACE" "$POSTGRES_OWNER" "$POSTGRES_BASELINE_FILE")"
fi
POSTGRES_BASELINE_SHA256="$(kubectl get configmap "$POSTGRES_BASELINE_CONFIG_MAP" -n "$NAMESPACE" -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
if [[ ! "$POSTGRES_BASELINE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  err "PostgreSQL target baseline '$POSTGRES_BASELINE_CONFIG_MAP' has no valid full SHA-256 identity."
  exit 1
fi

_load_kubernetes_api_helm_args networkPolicy "PostgreSQL pooler"
POSTGRES_KUBERNETES_API_ARGS=("${KUBERNETES_API_HELM_ARGS[@]}")
_load_kubernetes_api_helm_args memoryGateway "memory gateway"
MEMORY_GATEWAY_KUBERNETES_API_ARGS=("${KUBERNETES_API_HELM_ARGS[@]}")

_install_postgres_server() {
  local pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}}]'
  local databases_json="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"}]"
  local postgres_args=(upgrade --install "$POSTGRES_RELEASE" "$POSTGRES_CHART_DIR"
    --namespace "$NAMESPACE"
    --set-json "databases=$databases_json"
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME"
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET"
    --set-string "bootstrap.targetBaseline.sha256=$POSTGRES_BASELINE_SHA256"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$POSTGRES_BASELINE_CONFIG_MAP"
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql"
    --set-json "pooler.clientPodSelectors=$pooler_client_selectors_json"
    "${POSTGRES_KUBERNETES_API_ARGS[@]}")
  [[ -n "$POSTGRES_VALUES_FILE" ]] && postgres_args+=(--values "$POSTGRES_VALUES_FILE")
  [[ -n "$STORAGE_CLASS" ]] && postgres_args+=(--set-string "storage.storageClass=$STORAGE_CLASS")
  if helm status "$POSTGRES_RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    postgres_args+=(--reset-then-reuse-values)
  fi

  log "Reconciling PostgreSQL server against target baseline '$POSTGRES_BASELINE_CONFIG_MAP'…"
  helm "${postgres_args[@]}"
  kubectl wait --for=condition=Ready "cluster/${POSTGRES_RELEASE}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  # CNPG Pooler resources do not publish a Kubernetes Ready condition; the managed Deployment does.
  kubectl wait --for=create "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  kubectl wait --for=condition=available "deployment/${POSTGRES_RELEASE}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  for database_resource in "${POSTGRES_RELEASE}-obot" "${POSTGRES_RELEASE}-litellm"; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  done
  kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
}
_copy_cnpg_uri_secret() {
  local source_secret="$1"
  local target_secret="$2"
  local target_key="$3"
  # Stream the encoded CNPG URI directly into kubectl. Credentials never enter a shell
  # variable, command argument, log line, or generated repository file.
  kubectl get secret "$source_secret" -n "$NAMESPACE" -o jsonpath='{.data.uri}' \
    | base64 -d \
    | kubectl create secret generic "$target_secret" -n "$NAMESPACE" \
        --from-file="${target_key}=/dev/stdin" --dry-run=client -o yaml \
    | kubectl apply -f -
}
_install_postgres_server
POSTGRES_APP_SECRET="${POSTGRES_RELEASE}-opencrane-app"
OBOT_POSTGRES_APP_SECRET="${POSTGRES_RELEASE}-obot-app"
LITELLM_POSTGRES_APP_SECRET="${POSTGRES_RELEASE}-litellm-app"
POSTGRES_ADMIN_APP_SECRET="${POSTGRES_RELEASE}-admin"
POSTGRES_POOLER_HOST="${POSTGRES_RELEASE}-pooler"
# Five Prisma connections keep PgBouncer's thirty-connection logical-database budget authoritative.
publish_postgres_database_connection "$POSTGRES_CONNECTION_PUBLISHER" "$NAMESPACE" "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" opencrane "sslmode=disable&connection_limit=5&pool_timeout=5"
publish_postgres_database_connection "$POSTGRES_CONNECTION_PUBLISHER" "$NAMESPACE" "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" obot
publish_postgres_database_connection "$POSTGRES_CONNECTION_PUBLISHER" "$NAMESPACE" "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" litellm
publish_postgres_database_connection "$POSTGRES_CONNECTION_PUBLISHER" "$NAMESPACE" "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_APP_SECRET" "$POSTGRES_POOLER_HOST" opencrane

_assert_distinct_cnpg_app_credentials() {
  local app_secrets=("$@")
  local i
  local j
  local left_username
  local left_password
  local right_username
  local right_password
  for ((i = 0; i < ${#app_secrets[@]}; i++)); do
    left_username="$(kubectl get secret "${app_secrets[$i]}" -n "$NAMESPACE" -o jsonpath='{.data.username}')"
    left_password="$(kubectl get secret "${app_secrets[$i]}" -n "$NAMESPACE" -o jsonpath='{.data.password}')"
    for ((j = i + 1; j < ${#app_secrets[@]}; j++)); do
      right_username="$(kubectl get secret "${app_secrets[$j]}" -n "$NAMESPACE" -o jsonpath='{.data.username}')"
      right_password="$(kubectl get secret "${app_secrets[$j]}" -n "$NAMESPACE" -o jsonpath='{.data.password}')"
      if [[ "$left_username" == "$right_username" || "$left_password" == "$right_password" ]]; then
        err "CNPG authorities '${app_secrets[$i]}' and '${app_secrets[$j]}' must not share usernames or passwords."
        exit 1
      fi
    done
  done
}
_assert_distinct_cnpg_app_credentials "$POSTGRES_APP_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$LITELLM_POSTGRES_APP_SECRET"

# Per-database app secrets are canonical. Adapt only the key/name required by third-party charts.
OBOT_DSN_SECRET="${RELEASE}-obot"
LITELLM_DATABASE_SECRET="${RELEASE}-litellm-db"
_copy_cnpg_uri_secret "$OBOT_POSTGRES_APP_SECRET" "$OBOT_DSN_SECRET" dsn
_copy_cnpg_uri_secret "$LITELLM_POSTGRES_APP_SECRET" "$LITELLM_DATABASE_SECRET" DATABASE_URL

# ArtifactStore uses two distinct per-silo Ed25519 roles: the catalog signs bounded write leases
# and verifies promotion receipts; artifact-service verifies leases and signs receipts. The two
# two-key Secrets live in separate namespaces: no OpenCrane server RBAC reaches the service
# namespace, so projected volumes are backed by a real Kubernetes authority boundary.
ARTIFACT_NAMESPACE="${RELEASE}-artifacts"
ARTIFACT_CATALOG_KEY_SECRET="${RELEASE}-artifact-catalog-keys"
ARTIFACT_SERVICE_KEY_SECRET="${RELEASE}-artifact-service-keys"
kubectl create namespace "$ARTIFACT_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
_ensure_artifact_keys() {
  local key_dir
  local key
  if kubectl get secret "$ARTIFACT_CATALOG_KEY_SECRET" -n "$NAMESPACE" >/dev/null 2>&1 || kubectl get secret "$ARTIFACT_SERVICE_KEY_SECRET" -n "$ARTIFACT_NAMESPACE" >/dev/null 2>&1; then
    for key in lease-private.pem receipt-public.pem; do
      if [[ -z "$(kubectl get secret "$ARTIFACT_CATALOG_KEY_SECRET" -n "$NAMESPACE" -o "jsonpath={.data.${key//./\\.}}" 2>/dev/null)" ]]; then
        err "Artifact catalog key Secret '$ARTIFACT_CATALOG_KEY_SECRET' is missing '$key'. Recreate both artifact key Secrets only through this deploy engine."
        exit 1
      fi
    done
    for key in lease-public.pem receipt-private.pem; do
      if [[ -z "$(kubectl get secret "$ARTIFACT_SERVICE_KEY_SECRET" -n "$ARTIFACT_NAMESPACE" -o "jsonpath={.data.${key//./\\.}}" 2>/dev/null)" ]]; then
        err "Artifact service key Secret '$ARTIFACT_SERVICE_KEY_SECRET' is missing '$key'. Recreate both artifact key Secrets only through this deploy engine."
        exit 1
      fi
    done
    return
  fi
  key_dir="$(mktemp -d)"
  trap 'rm -rf "$key_dir"' RETURN
  openssl genpkey -algorithm ED25519 -out "$key_dir/lease-private.pem"
  openssl pkey -in "$key_dir/lease-private.pem" -pubout -out "$key_dir/lease-public.pem"
  openssl genpkey -algorithm ED25519 -out "$key_dir/receipt-private.pem"
  openssl pkey -in "$key_dir/receipt-private.pem" -pubout -out "$key_dir/receipt-public.pem"
  kubectl create secret generic "$ARTIFACT_CATALOG_KEY_SECRET" -n "$NAMESPACE" \
    --from-file=lease-private.pem="$key_dir/lease-private.pem" \
    --from-file=receipt-public.pem="$key_dir/receipt-public.pem" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl create secret generic "$ARTIFACT_SERVICE_KEY_SECRET" -n "$ARTIFACT_NAMESPACE" \
    --from-file=lease-public.pem="$key_dir/lease-public.pem" \
    --from-file=receipt-private.pem="$key_dir/receipt-private.pem" \
    --dry-run=client -o yaml | kubectl apply -f -
}
_ensure_artifact_keys

kubectl create secret generic opencrane-litellm -n "$NAMESPACE" \
  --from-literal=LITELLM_MASTER_KEY="$LITELLM_MASTER_KEY" \
  --from-literal=LITELLM_SALT_KEY="$LITELLM_SALT_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
ensure_provider_key_secrets "$NAMESPACE"
publish_initial_model_provider_secret "$NAMESPACE" "$INITIAL_MODEL_PROVIDER" "$INITIAL_MODEL_API_KEY"
# OIDC secret. The chart references clustertenantManager.oidc.existingSecret for the client + session
# secrets; previously this installer set only the issuer/clientId/redirect and ASSUMED the
# Secret already existed, so a fresh OIDC install rendered a UI that crash-looped on a missing
# Secret. A fresh install still requires a confidential-client secret. An upgrade may retain an
# already valid Secret, so routine image/config rollouts neither require re-supplying an IdP
# secret nor rotate the session-signing key.
if [[ -n "$OIDC_ISSUER_URL" ]]; then
  if [[ -z "$OIDC_CLIENT_SECRET" ]]; then
    if kubectl get secret "$OIDC_SECRET_NAME" -n "$NAMESPACE" >/dev/null 2>&1 \
      && kubectl get secret "$OIDC_SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.OIDC_CLIENT_SECRET}' | grep -q . \
      && kubectl get secret "$OIDC_SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.OIDC_SESSION_SECRET}' | grep -q .; then
      log "Retaining existing OIDC secret '$OIDC_SECRET_NAME' (no client-secret input supplied)."
    else
      err "OIDC is configured (--oidc-issuer-url set) but no client secret was provided and no complete '$OIDC_SECRET_NAME' exists. Pass --oidc-client-secret (or OPENCRANE_OIDC_CLIENT_SECRET)."
      exit 1
    fi
  else
    OIDC_SESSION_SECRET="${OIDC_SESSION_SECRET:-$(_gen_secret)}"
    log "Creating the OIDC secret '$OIDC_SECRET_NAME' (client + session secret)…"
    kubectl create secret generic "$OIDC_SECRET_NAME" -n "$NAMESPACE" \
      --from-literal=OIDC_CLIENT_SECRET="$OIDC_CLIENT_SECRET" \
      --from-literal=OIDC_SESSION_SECRET="$OIDC_SESSION_SECRET" \
      --dry-run=client -o yaml | kubectl apply -f -
  fi
fi

# A standalone owner row is keyed by OIDC subject, whose namespace is its issuer. Once a silo
# has an eligible first-user contract, changing the issuer through this deployment engine would
# make that durable subject ambiguous. Create a new silo for an IdP migration instead.
_guard_standalone_first_user_issuer() {
  local prior_values
  local prior_issuer=""
  local prior_first_user_email=""
  local requested_issuer="$OIDC_ISSUER_URL"
  local extra_set_index
  local extra_set_value
  local extra_helm_arg
  if ! helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    return
  fi
  prior_values="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null || echo '{}')"
  if command -v jq >/dev/null 2>&1; then
    prior_issuer="$(printf '%s' "$prior_values" | jq -r '.clustertenantManager.oidc.issuerUrl // empty')"
    prior_first_user_email="$(printf '%s' "$prior_values" | jq -r '.clustertenantManager.firstUser.email // empty')"
  else
    prior_issuer="$(printf '%s' "$prior_values" | grep -o '"issuerUrl":"[^"]*' | head -1 | cut -d'"' -f4 || true)"
    prior_first_user_email="$(printf '%s' "$prior_values" | grep -o '"firstUser":[^}]*"email":"[^"]*' | head -1 | cut -d'"' -f6 || true)"
  fi

  # The initial first-owner issuer is a durable subject namespace. For its later upgrades,
  # require the normal issuer flag and retain only the engine's value-preserving mode. This
  # prevents `--values` and `--reset-values` from silently replacing or erasing the binding.
  if [[ -n "$prior_first_user_email" ]]; then
    if [[ -z "$requested_issuer" ]]; then
      err "An existing standalone first-owner contract requires --oidc-issuer-url on every upgrade so its immutable issuer can be verified."
      exit 1
    fi
    if [[ -n "$VALUES_FILE" || -n "$RESET_VALUES" ]]; then
      err "Do not use --values or --reset-values after a standalone first owner is configured; they can replace or erase its immutable issuer binding."
      exit 1
    fi
  fi

  # `--set` is applied after normal flags. Treat it as the requested issuer so the
  # immutable first-owner binding cannot be bypassed by omitting --first-user-email.
  for ((extra_set_index = 1; extra_set_index < ${#EXTRA_SET[@]}; extra_set_index += 2)); do
    extra_set_value="${EXTRA_SET[$extra_set_index]}"
    if [[ "$extra_set_value" == clustertenantManager.oidc.issuerUrl=* ]]; then
      requested_issuer="${extra_set_value#clustertenantManager.oidc.issuerUrl=}"
    fi
    if [[ -n "$prior_first_user_email" && "$extra_set_value" == clustertenantManager.firstUser.* ]]; then
      err "Do not override clustertenantManager.firstUser through --set after a standalone first owner is configured."
      exit 1
    fi
  done
  # With `set -u`, Bash treats an initialized-but-empty array as unset when it
  # is expanded inside a `for` list. Keep the immutable-binding guard usable
  # for normal deployments that do not pass any raw Helm arguments.
  for extra_helm_arg in "${EXTRA_HELM_ARGS[@]-}"; do
    if [[ -n "$prior_first_user_email" && "$extra_helm_arg" == *clustertenantManager.oidc.issuerUrl* ]]; then
      err "Do not override clustertenantManager.oidc.issuerUrl through --helm-arg after a standalone first owner is configured. Pass --oidc-issuer-url so the immutable issuer guard can validate it."
      exit 1
    fi
    if [[ -n "$prior_first_user_email" && "$extra_helm_arg" == *clustertenantManager.firstUser* ]]; then
      err "Do not override clustertenantManager.firstUser through --helm-arg after a standalone first owner is configured."
      exit 1
    fi
  done

  if [[ -n "$prior_first_user_email" && -n "$prior_issuer" && "$prior_issuer" != "$requested_issuer" ]]; then
    err "Standalone first-owner issuer is immutable after deployment ('$prior_issuer' -> '$requested_issuer'). Create a new silo for an IdP migration."
    exit 1
  fi
}
_guard_standalone_first_user_issuer

ensure_registry_pull_secret "$NAMESPACE" "$REGISTRY_PULL_SECRET" "$REGISTRY_PULL_CONFIG_FILE"

# 3. The OpenCrane chart.
log "Using current app-owned chart sources from the committed dependency lock…"

log "Installing the OpenCrane Helm release '$RELEASE'…"
# --force-conflicts: Helm 4 applies server-side, so any out-of-band actor that has
# claimed field ownership of a chart-rendered field (e.g. a `kubectl patch`/`kubectl set
# image` leaving a `kubectl-*` manager, or a now-removed operator drift-repairer whose
# stale `node-fetch` ownership persists on the live object — see the warning above and
# issue #146) makes `helm upgrade` fail with a field-ownership conflict. This engine's
# contract is that Helm is the SOLE owner of chart-rendered fields, so on conflict Helm
# should always reclaim them. Idempotent: a no-op when there is no conflicting manager,
# and it only forces fields the chart actually applies (foreign managers of OTHER fields
# are untouched). Without it a single stray imperative patch wedges every future upgrade.
helm_args=(upgrade --install "$RELEASE" "$CHART_DIR" --namespace "$NAMESPACE" --create-namespace
  --force-conflicts
  --set-string "networkPolicy.postgresPoolerName=$POSTGRES_POOLER_HOST"
  --set-string "clustertenantManager.database.existingSecret=$POSTGRES_APP_SECRET"
  --set-string "clustertenantManager.database.secretKey=uri"
  --set-string "litellm.existingDatabaseSecret=$LITELLM_DATABASE_SECRET"
  --set-string "litellm.databaseSecretKey=DATABASE_URL"
  # The server registers provider models through LiteLLM's admin API. That API is only
  # available when LiteLLM persists models in its configured PostgreSQL database.
  --set "litellm.storeModelInDb=true"
  --set-string "litellm.existingSaltSecret=opencrane-litellm"
  --set-string "litellm.saltSecretKey=LITELLM_SALT_KEY"
  --set-string "artifactService.persistence.storageClass=$ARTIFACT_STORAGE_CLASS"
  --set-string "artifactService.namespace=$ARTIFACT_NAMESPACE"
  --set-string "artifactService.keys.catalogExistingSecret=$ARTIFACT_CATALOG_KEY_SECRET"
  --set-string "artifactService.keys.serviceExistingSecret=$ARTIFACT_SERVICE_KEY_SECRET"
  --set "litellm.existingSecret=opencrane-litellm"
  "${MEMORY_GATEWAY_KUBERNETES_API_ARGS[@]}")
[[ -n "$REGISTRY_PULL_SECRET" ]] && helm_args+=(--set-string "global.imagePullSecret=$REGISTRY_PULL_SECRET")
# Pinned-tag float guard: detect if the prior release pinned component images to a specific
# tag. If this invocation does not restate it (no --opencrane-server-tag),
# re-pin from the prior release so they don't silently float to chart-default (a 2026-07-12 live gotcha).
# Escape: OPENCRANE_ALLOW_TAG_FLOAT=1 to intentionally float tags.
_enforce_tag_pins() {
  # Only check on an existing release (upgrade path). Fresh installs have no prior values.
  if ! helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    return 0
  fi
  # Allow explicit float escape.
  if [[ "$ALLOW_TAG_FLOAT" == "1" ]]; then
    return 0
  fi
  # Check what tags are pinned in the PRIOR release, and what THIS run explicitly sets.
  local prior_cp prior_vals
  prior_vals="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null || echo '{}')"

  # Extract tags using jq if available, otherwise fall back to grep.
  if command -v jq >/dev/null 2>&1; then
    prior_cp="$(echo "$prior_vals" | jq -r '.clustertenantManager.image.tag // empty')"
  else
    # Grep fallback for when jq is not available (simple pattern, may miss nested structures).
    prior_cp="$(echo "$prior_vals" | grep -o '"clustertenantManager":[^}]*"tag":"[^"]*' | grep -o '"tag":"[^"]*' | head -1 | cut -d'"' -f4 || true)"
  fi

  local need_warn=0
  # If prior release had a tag and this run doesn't set one, re-pin it.
  if [[ -n "$prior_cp" && -z "$CONTROL_PLANE_TAG" ]]; then
    warn "Prior release had clustertenantManager.image.tag='$prior_cp' — re-pinning (to avoid silent float to chart-default). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to float intentionally."
    CONTROL_PLANE_TAG="$prior_cp"
    need_warn=1
  fi
  if [[ "$need_warn" == "1" ]]; then
    warn "Image-tag re-pin: tags were auto-restored from the prior release. Run evidence: $(date -u +%Y-%m-%dT%H:%M:%SZ) $(hostname)"
  fi
}
_enforce_tag_pins

# Per-component tags override the unified --image-tag so a single component can be
# rolled through Helm (which keeps Helm the sole owner of the image field). Each
# falls back to IMAGE_TAG when its flag is unset, preserving the all-same default.
CP_TAG="${CONTROL_PLANE_TAG:-$IMAGE_TAG}"
# --set-string: a tag like "1.2.3" or a numeric-looking sha must never be YAML-coerced
# (same guideline as the OIDC string values below; see the deploy ledger).
[[ -n "$CP_TAG" ]] && helm_args+=(--set-string "clustertenantManager.image.tag=$CP_TAG")
# --base-domain drives ingress.domain; controlPlaneHost defaults to platform.<domain>
# in the chart. Setting it explicitly here keeps one source of truth for release hosts.
[[ -n "$BASE_DOMAIN" ]] && helm_args+=(--set "ingress.domain=$BASE_DOMAIN")
# OIDC human login is required by the deploy profile and rendered when an issuer URL is supplied.
# --set-string (NOT --set): a large numeric Zitadel clientId passed via --set is YAML-parsed
# as a float and rendered in scientific notation (e.g. 3.78…e+17) → Zitadel App.NotFound and
# all login breaks. Strings stay strings (issue #100).
[[ -n "$OIDC_ISSUER_URL" ]]   && helm_args+=(--set-string "clustertenantManager.oidc.issuerUrl=$OIDC_ISSUER_URL")
[[ -n "$OIDC_CLIENT_ID" ]]    && helm_args+=(--set-string "clustertenantManager.oidc.clientId=$OIDC_CLIENT_ID")
[[ -n "$OIDC_REDIRECT_URI" ]] && helm_args+=(--set-string "clustertenantManager.oidc.redirectUri=$OIDC_REDIRECT_URI")
# Point the chart at the Secret created above (client + session secret) instead of leaving
# its inline values empty — keeps secrets out of Helm values + the rendered manifest.
[[ -n "$OIDC_ISSUER_URL" ]]   && helm_args+=(--set-string "clustertenantManager.oidc.existingSecret=$OIDC_SECRET_NAME")
# Platform-operator bootstrap (seed email and/or IdP group mapping). Set only when non-empty.
if [[ -n "$PLATFORM_OPERATOR_SEED_EMAIL" ]]; then
  helm_args+=(--set-string "clustertenantManager.oidc.platformOperatorSeedEmail=$PLATFORM_OPERATOR_SEED_EMAIL")
  warn "Seeding platform operator for the cluster (verified OIDC email match). Remove the seed once a group mapping is in place."
fi
if [[ -n "$PLATFORM_OPERATOR_GROUPS" ]]; then
  helm_args+=(--set-string "clustertenantManager.oidc.platformOperatorGroups=$PLATFORM_OPERATOR_GROUPS")
fi
if [[ -n "$FIRST_USER_EMAIL" ]]; then
  helm_args+=(--set-string "clustertenantManager.firstUser.email=$FIRST_USER_EMAIL")
fi
build_initial_model_provider_helm_args "$INITIAL_MODEL_PROVIDER"
helm_args+=("${INITIAL_MODEL_PROVIDER_HELM_ARGS[@]}")
[[ -n "$VALUES_FILE" ]] && helm_args+=(--values "$VALUES_FILE")
helm_args+=("${EXTRA_SET[@]}")
# Raw helm-arg passthrough for sanctioned one-time fixes (e.g. --take-ownership).
[[ ${#EXTRA_HELM_ARGS[@]} -gt 0 ]] && helm_args+=("${EXTRA_HELM_ARGS[@]}")
# Value-preservation mode. Helm's DEFAULT on upgrade drops any value a prior release set
# via --set/-f that this invocation does not restate, silently reverting it to the chart
# default — a footgun that broke a live silo once (a pure `--opencrane-server-tag` bump reverted
# ingress/TLS/resource limits;
# see the field-manager warning above). So for an UPGRADE (the release already exists) we
# default to `--reset-then-reuse-values`: reset to the chart's built-in values (picking up any
# new chart defaults), re-apply the last release's values, then merge this run's --set/-f on top.
# That preserves prior overrides without staling on chart defaults. Explicit flags win:
#   --reuse-values  → inherit last release verbatim (do NOT refresh chart defaults)
#   --reset-values  → intentionally DROP prior overrides (start from chart defaults + this run)
# A fresh install has nothing to reuse, so none of these apply.
if [[ -n "$REUSE_VALUES" ]]; then
  helm_args+=(--reuse-values)
elif [[ -n "$RESET_VALUES" ]]; then
  helm_args+=(--reset-values)
elif helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
  log "Existing release '$RELEASE' — using --reset-then-reuse-values so prior overrides are not silently dropped (pass --reset-values to start from chart defaults instead)."
  helm_args+=(--reset-then-reuse-values)
fi
helm "${helm_args[@]}"
restart_postgres_connection_consumers "$NAMESPACE" "$TIMEOUT" "${RELEASE}-opencrane-server" "${RELEASE}-litellm" "${RELEASE}-mcp-gateway"

# 4. Wait for the core workloads. The database schema was fixed during CNPG initdb;
# application startup never mutates it. A changed baseline requires a clean database.
# Wait only on the deployment(s) this chart actually rendered: the fleet chart ships
# the fleet-manager, the silo chart the clustertenant-manager. A fleet-only (or silo-only)
# install has just one, so guard each wait on the deployment existing rather than waiting
# unconditionally (which NotFound-errored on the absent component after the split).
for _comp in fleet-manager clustertenant-manager; do
  if kubectl get "deployment/${RELEASE}-${_comp}" -n "$NAMESPACE" >/dev/null 2>&1; then
    kubectl rollout status "deployment/${RELEASE}-${_comp}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  fi
done

_wait_for_release_certificate

_post_deploy_verify

log "Done. OpenCrane is installed in namespace '$NAMESPACE'."
_cp_hosts="$(_control_plane_hosts)"
if [[ -n "$_cp_hosts" ]]; then
  log "Point your DNS at the ingress, then visit:"
  while IFS= read -r _h; do [[ -n "$_h" ]] && log "  https://$_h"; done <<< "$_cp_hosts"
fi
log "Ingress: kubectl get ingress -n $NAMESPACE"
