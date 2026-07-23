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
#                            [--opencrane-server-tag TAG] [--operator-tag TAG]
#                            [--tenant-tag TAG]
#                            [--oidc-issuer-url URL] [--oidc-client-id ID]
#                            [--oidc-redirect-uri URI] [--oidc-client-secret SECRET]
#                            [--oidc-session-secret SECRET]
#                            [--platform-operator-seed-email EMAIL]
#                            [--platform-operator-groups CSV]
#                            [--preflight] [--multi-ct]
#                            --postgres-credentials-secret NAME
#                            [--postgres-owner OWNER]
#                            [--fleet-postgres-credentials-secret NAME] [--fleet-postgres-owner OWNER]
#                            --obot-postgres-credentials-secret NAME [--obot-postgres-owner OWNER]
#                            --litellm-postgres-credentials-secret NAME [--litellm-postgres-owner OWNER]
#                            --langfuse-postgres-credentials-secret NAME [--langfuse-postgres-owner OWNER]
#                            --postgres-admin-credentials-secret NAME [--postgres-admin-name NAME]
#                            [--postgres-values FILE]
#                            [--no-ingress-nginx]
#                            [--no-external-dns]
#                            [--cert-manager] [--acme-email EMAIL]
#                            [--dns01-provider clouddns] [--dns01-credentials FILE]
#                            [--dns01-project PROJECT_ID] [--dns-writer-gsa EMAIL]
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
# those tags (no --opencrane-server-tag/--operator-tag/--tenant-tag) and does not explicitly float
# (OPENCRANE_ALLOW_TAG_FLOAT=1), the script detects the prior pin, warns loudly, and
# automatically re-pins from the last release so pinned tags float silently (a live gotcha from
# 2026-07-12 deploy). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to intentionally float tags to chart-default.
#
# Raw Helm-arg passthrough: --helm-arg ARG (or OPENCRANE_HELM_EXTRA_ARGS='ARG1 ARG2 …')
# appends verbatim arguments to the final helm upgrade invocation. Useful for sanctioned
# one-time fixes like --take-ownership (e.g. when a Certificate loses ownership across versions).
# Repeatable: --helm-arg --take-ownership --helm-arg --force-fields-order.
#
# TLS / cert-manager (Step 2.5) has THREE modes:
#   off (default)  — no cert-manager install; the chart renders no issuer/cert.
#                    Use when TLS is terminated elsewhere (LB, external ingress).
#   selfSigned     — `--cert-manager` alone. Installs cert-manager and a self-signed
#                    ClusterIssuer. Issues instantly, no DNS challenge, NOT browser-
#                    trusted. For dev / k3d / bare-IP clusters.
#   acme (DNS-01)  — `--cert-manager --acme-email you@org --dns01-provider clouddns
#                    [--dns01-credentials FILE]`. Installs cert-manager, waits on the
#                    webhook, runs a DNS-01 preflight that FAILS FAST with the exact
#                    remediation, then issues a browser-trusted wildcard via Let's
#                    Encrypt. Wildcards REQUIRE DNS-01 (HTTP-01 cannot issue them).
#                    On GKE Workload Identity pass --dns-writer-gsa EMAIL (Terraform output
#                    dns_writer_service_account_email): the cert-manager + external-dns
#                    controller SAs are annotated with this SHARED GSA, which must already be
#                    bound roles/dns.admin. For an external zone pass a SA-key file via
#                    --dns01-credentials instead (a Secret is created in the cert-manager NS).
#
# This step installs only the PLATFORM-WILDCARD issuer + cert. Per-org certs are a
# runtime concern of the ClusterTenant reconciler, NOT an install concern.
#
# --base-domain is the platform org-wildcard BASE domain (e.g. dev.opencrane.ai). It is
# a first-class, VALIDATED install input (lowercase FQDN, ≥2 labels) that drives a single
# source of truth: the chart's ingress.domain, the derived controlPlaneHost
# (platform.<base-domain>), the cert-manager wildcard SANs (*.<domain>, <domain>,
# controlPlaneHost), and the operator's per-org domain provisioning. NEVER hardcode a
# real domain in the repo. `--domain` remains a backwards-compatible alias; acme TLS
# REQUIRES --base-domain (a wildcard for *.<empty> is meaningless).
#
# Bundled cluster singletons (default ON, auto-skip if already present):
#   ingress-nginx — the ingress controller (skip with --no-ingress-nginx to BYO one).
#   external-dns  — the DNS-record controller (skip with --no-external-dns to BYO one).
#                   The operator emits namespaced DNSEndpoint CRs; external-dns (run with
#                   --source=crd) reconciles them into Google Cloud DNS, scoped to
#                   --base-domain, against the SAME managed zone as the cert-manager
#                   DNS-01 solver. It needs zone write access → it SHARES the cert-manager
#                   DNS-01 credentials: Workload Identity (the cert-manager SA's GSA bound
#                   roles/dns.admin) by default, or the --dns01-credentials SA-key file for
#                   an external zone. external-dns is only bundled in acme/clouddns mode
#                   (that is where the shared zone + WI binding are established).
#   Cognee        — the required graph-RAG service, installed IN-CHART via
#                   clustertenantManager.cognee.install=true (set false to BYO an external one).
# Each is gated by a `*.install` flag SEPARATE from the chart's `*.enabled`, so an
# operator can bring their own while the chart still wires against it.
#
# The platform-operator seed email bootstraps the FIRST platform operator: the
# caller whose VERIFIED OIDC email equals it becomes a platform operator. It is a
# per-cluster INSTALL parameter — DEFAULTS TO EMPTY, which grants operator to
# nobody (fail-closed). Also accepted via the OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL
# env var. Never commit a real owner email into the repo.
#
# --image-tag pins all three platform images (opencrane-ui, operator, tenant)
# to the same tag. To roll a SINGLE component to a different build, pass the
# matching per-component flag (e.g. --opencrane-server-tag sha-abc123); it overrides
# --image-tag for that component only. ALWAYS bump component images this way —
# never `kubectl set image` / `kubectl patch` a managed deployment. An imperative
# patch creates a `kubectl-*` field manager that owns the image field on the live
# object and makes every later `helm upgrade` fail with a field-ownership conflict.
#
# Prereqs: kubectl (pointed at the target cluster), helm, an externally installed
# CloudNativePG operator, and a pre-created PostgreSQL basic-auth Secret.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The Helm chart no longer sits beside this engine — it is per-role and lives in the calling
# app (the fleet chart, now in the WeOwnAI repo per elewa-git/opencrane#150; apps/_infra/deploy-k8s
# = the silo chart, still here). Each app's deploy.sh wrapper exports OPENCRANE_CHART_DIR to its
# own chart dir before exec'ing this engine; running k8s-deploy.sh directly without it fails loud
# rather than guessing.
CHART_DIR="${OPENCRANE_CHART_DIR:-}"
if [[ -z "$CHART_DIR" ]]; then
  echo "[k8s-deploy] OPENCRANE_CHART_DIR is unset. Run a role wrapper deploy.sh — the fleet-platform chart's deploy.sh (now in WeOwnAI) or apps/_infra/deploy-k8s/deploy.sh — not k8s-deploy.sh directly." >&2
  exit 1
fi
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
OPERATOR_TAG=""         # empty → falls back to IMAGE_TAG
TENANT_TAG=""           # empty → falls back to IMAGE_TAG
# --base-domain (canonical) is the platform org-wildcard BASE domain for this install
# (e.g. dev.opencrane.ai). It drives the chart's ingress.domain + the derived
# controlPlaneHost (platform.<base-domain>), the cert-manager wildcard SANs, and the
# operator's per-org provisioning. NEVER hardcode a real domain in the repo — it is a
# per-install input. `--domain` is kept as a backwards-compatible alias. Also accepts
# OPENCRANE_BASE_DOMAIN so the wizard / CI can supply it off the command line.
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
# Platform-operator GROUP mapping (CSV of IdP groups). OR-ed with the seed email; the
# durable bootstrap once an IdP group exists. Empty → unset (fail-closed).
PLATFORM_OPERATOR_GROUPS="${OPENCRANE_PLATFORM_OPERATOR_GROUPS:-}"

# cert-manager / TLS (Step 2.5). CERT_MANAGER stays off unless --cert-manager is given;
# the mode is then selfSigned UNLESS an --acme-email + --dns01-provider promote it to
# acme. ACME_EMAIL / DNS01_PROVIDER also accept env vars so CI/secret managers can
# supply them off the command line. DNS01_CREDENTIALS is a path to a SA-key JSON used
# only for an EXTERNAL DNS zone (Workload Identity needs no file — see _preflight_dns01).
# OPENCRANE_CERT_MODE (off|selfSigned|acme) lets the wizard preset the mode without the
# CLI flag; "off" leaves CERT_MANAGER off, anything else turns it on (acme is then driven
# by the email/provider env below). Direct callers just use --cert-manager / --acme-email.
case "${OPENCRANE_CERT_MODE:-off}" in
  off) CERT_MANAGER="off" ;;
  *)   CERT_MANAGER="on" ;;
esac
ACME_EMAIL="${OPENCRANE_ACME_EMAIL:-${ACME_EMAIL:-}}"
DNS01_PROVIDER="${OPENCRANE_DNS01_PROVIDER:-${DNS01_PROVIDER:-}}"
DNS01_CREDENTIALS="${OPENCRANE_DNS01_CREDENTIALS:-${DNS01_CREDENTIALS:-}}"
# GCP project that hosts the Cloud DNS zone for --base-domain. cert-manager's clouddns
# solver requires a project (under BOTH Workload Identity and an external SA key), so it
# is required in acme/clouddns mode. Defaults from the gcloud active project when unset.
DNS01_PROJECT="${OPENCRANE_DNS01_PROJECT:-${DNS01_PROJECT:-}}"
CERT_MANAGER_NAMESPACE="cert-manager"

# ingress-nginx bundling (a cluster singleton like cert-manager). Installed by default
# so a fresh cluster gets a working ingress class with no extra step; auto-skips when a
# controller is already present. `--no-ingress-nginx` (or OPENCRANE_INSTALL_INGRESS_NGINX=0)
# turns the bundling off to BYO a controller. This is SEPARATE from the chart's
# ingress.enabled (whether Ingress objects render) — see values.yaml `ingressNginx`.
INSTALL_INGRESS_NGINX="${OPENCRANE_INSTALL_INGRESS_NGINX:-1}"
INGRESS_NGINX_NAMESPACE="ingress-nginx"

# external-dns bundling (a cluster singleton like ingress-nginx / cert-manager). The
# operator emits namespaced DNSEndpoint CRs and external-dns (--source=crd) reconciles
# them into Google Cloud DNS, scoped to --base-domain, against the SAME managed zone as
# the cert-manager DNS-01 solver and SHARING its zone-write credentials (WI roles/dns.admin
# or the --dns01-credentials SA key). Installed by default, auto-skips when a controller is
# already present. `--no-external-dns` (or OPENCRANE_INSTALL_EXTERNAL_DNS=0) turns the
# bundling off to BYO a controller. SEPARATE from the chart's externalDns.enabled (whether
# the operator declares DNSEndpoint CRs at all) — see values.yaml `externalDns`. Only
# bundled in acme/clouddns mode, which is where the shared zone + WI binding are set up.
INSTALL_EXTERNAL_DNS="${OPENCRANE_INSTALL_EXTERNAL_DNS:-1}"
EXTERNAL_DNS_NAMESPACE="external-dns"
# CloudNativePG is an external cluster prerequisite. OpenCrane never installs or upgrades
# the operator. The credentials Secret is also external: this deploy flow only validates and
# references it, so database passwords never pass through shell generation or repair paths.
POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_POSTGRES_CREDENTIALS_SECRET:-}"
POSTGRES_VALUES_FILE="${OPENCRANE_POSTGRES_VALUES:-}"
POSTGRES_OWNER="${OPENCRANE_POSTGRES_OWNER:-opencrane}"
FLEET_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_FLEET_POSTGRES_CREDENTIALS_SECRET:-}"
FLEET_POSTGRES_OWNER="${OPENCRANE_FLEET_POSTGRES_OWNER:-opencrane_fleet}"
OBOT_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_OBOT_POSTGRES_CREDENTIALS_SECRET:-}"
OBOT_POSTGRES_OWNER="${OPENCRANE_OBOT_POSTGRES_OWNER:-obot}"
LITELLM_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_LITELLM_POSTGRES_CREDENTIALS_SECRET:-}"
LITELLM_POSTGRES_OWNER="${OPENCRANE_LITELLM_POSTGRES_OWNER:-litellm}"
LANGFUSE_POSTGRES_CREDENTIALS_SECRET="${OPENCRANE_LANGFUSE_POSTGRES_CREDENTIALS_SECRET:-}"
LANGFUSE_POSTGRES_OWNER="${OPENCRANE_LANGFUSE_POSTGRES_OWNER:-langfuse}"
POSTGRES_ADMIN_CREDENTIALS_SECRET="${OPENCRANE_POSTGRES_ADMIN_CREDENTIALS_SECRET:-}"
POSTGRES_ADMIN_NAME="${OPENCRANE_POSTGRES_ADMIN_NAME:-opencrane_database_admin}"
# The central fleet profile owns a separate registry database. Silo wrappers disable
# it through fleetManager.enabled=false; an explicit environment override exists for
# other thin profiles that do not render the fleet manager.
INSTALL_FLEET_DATABASE="${OPENCRANE_INSTALL_FLEET_DATABASE:-1}"
# The shared DNS-writer Google service account (Terraform `dns` module output
# dns_writer_service_account_email) external-dns + the cert-manager DNS-01 solver impersonate
# via Workload Identity. On GKE the controller's KSA must carry the annotation
# `iam.gke.io/gcp-service-account=<this>` to complete the WI handshake — Terraform creates the
# binding, but the KSA annotation is an install-time concern. Required for the WI path (no
# --dns01-credentials) on GKE; ignored for the external-SA-key path. Also OPENCRANE_DNS_WRITER_GSA.
DNS_WRITER_GSA="${OPENCRANE_DNS_WRITER_GSA:-${DNS_WRITER_GSA:-}}"

# --preflight runs a fail-FAST environment check BEFORE any cluster mutation and exits 0/1
# without installing. It catches the failures that otherwise surface as a half-installed,
# crash-looping cluster: no default StorageClass (every PVC pends), a CNI that silently
# ignores NetworkPolicy (the isolation model is a no-op), unpullable first-party images,
# a base domain whose NS delegation does not resolve (acme orders + external-dns hang), and
# a missing DNS-write capability shared by external-dns + cert-manager. Also via
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

# --auto-ingress-ip derives ingress.externalIp from the ingress-nginx LoadBalancer after
# it is installed (so per-org *.<domain> A records resolve without hand-copying the IP).
# Opt-in; an explicit ingress.externalIp --set always wins. Also via OPENCRANE_AUTO_INGRESS_IP=1.
AUTO_INGRESS_IP="${OPENCRANE_AUTO_INGRESS_IP:-0}"
# --verify runs an advisory post-deploy check (pods Running, DNSEndpoints present, external-dns
# error-free, opencrane-ui host resolves). Never fails the install. Also via OPENCRANE_VERIFY=1.
VERIFY="${OPENCRANE_VERIFY:-0}"

POSTGRES_RELEASE=""
TIMEOUT="${TIMEOUT_SECONDS:-300}"

log()  { echo -e "\033[0;32m[k8s-deploy]\033[0m $1"; }
warn() { echo -e "\033[1;33m[k8s-deploy]\033[0m $1"; }
err()  { echo -e "\033[0;31m[k8s-deploy]\033[0m $1" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-domain)   BASE_DOMAIN="$2"; shift 2 ;;
    --domain)        BASE_DOMAIN="$2"; shift 2 ;;  # backwards-compatible alias
    --namespace)     NAMESPACE="$2"; shift 2 ;;
    --release)       RELEASE="$2"; shift 2 ;;
    --image-tag)        IMAGE_TAG="$2"; shift 2 ;;
    --opencrane-server-tag) CONTROL_PLANE_TAG="$2"; shift 2 ;;
    --opencrane-ui-tag)     CONTROL_PLANE_TAG="$2"; shift 2 ;;  # backwards-compatible alias (pins the opencrane-server image)
    --operator-tag)     OPERATOR_TAG="$2"; shift 2 ;;
    --tenant-tag)       TENANT_TAG="$2"; shift 2 ;;
    --storage-class) STORAGE_CLASS="$2"; shift 2 ;;
    --oidc-issuer-url)     OIDC_ISSUER_URL="$2"; shift 2 ;;
    --oidc-client-id)      OIDC_CLIENT_ID="$2"; shift 2 ;;
    --oidc-redirect-uri)   OIDC_REDIRECT_URI="$2"; shift 2 ;;
    --oidc-client-secret)  OIDC_CLIENT_SECRET="$2"; shift 2 ;;
    --oidc-session-secret) OIDC_SESSION_SECRET="$2"; shift 2 ;;
    --platform-operator-seed-email) PLATFORM_OPERATOR_SEED_EMAIL="$2"; shift 2 ;;
    --platform-operator-groups)     PLATFORM_OPERATOR_GROUPS="$2"; shift 2 ;;
    --preflight)        PREFLIGHT="1"; shift ;;
    --multi-ct)         MULTI_CT="1"; shift ;;
    --auto-ingress-ip)  AUTO_INGRESS_IP="1"; shift ;;
    --verify)           VERIFY="1"; shift ;;
    --no-ingress-nginx) INSTALL_INGRESS_NGINX="0"; shift ;;
    --no-external-dns)  INSTALL_EXTERNAL_DNS="0"; shift ;;
    --postgres-credentials-secret) POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --postgres-owner) POSTGRES_OWNER="$2"; shift 2 ;;
    --fleet-postgres-credentials-secret) FLEET_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --fleet-postgres-owner) FLEET_POSTGRES_OWNER="$2"; shift 2 ;;
    --obot-postgres-credentials-secret) OBOT_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --obot-postgres-owner) OBOT_POSTGRES_OWNER="$2"; shift 2 ;;
    --litellm-postgres-credentials-secret) LITELLM_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --litellm-postgres-owner) LITELLM_POSTGRES_OWNER="$2"; shift 2 ;;
    --langfuse-postgres-credentials-secret) LANGFUSE_POSTGRES_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --langfuse-postgres-owner) LANGFUSE_POSTGRES_OWNER="$2"; shift 2 ;;
    --postgres-admin-credentials-secret) POSTGRES_ADMIN_CREDENTIALS_SECRET="$2"; shift 2 ;;
    --postgres-admin-name) POSTGRES_ADMIN_NAME="$2"; shift 2 ;;
    --postgres-values) POSTGRES_VALUES_FILE="$2"; shift 2 ;;
    --dns-writer-gsa)   DNS_WRITER_GSA="$2"; shift 2 ;;
    --cert-manager)  CERT_MANAGER="on"; shift ;;
    --acme-email)    ACME_EMAIL="$2"; shift 2 ;;
    --dns01-provider)    DNS01_PROVIDER="$2"; shift 2 ;;
    --dns01-credentials) DNS01_CREDENTIALS="$2"; shift 2 ;;
    --dns01-project)     DNS01_PROJECT="$2"; shift 2 ;;
    --values)        VALUES_FILE="$2"; shift 2 ;;
    --reuse-values)  REUSE_VALUES="1"; shift ;;
    --reset-values)  RESET_VALUES="1"; shift ;;
    --set)
      [[ "$2" == "fleetManager.enabled=false" ]] && INSTALL_FLEET_DATABASE="0"
      EXTRA_SET+=(--set "$2"); shift 2
      ;;
    --helm-arg)      EXTRA_HELM_ARGS+=("$2"); shift 2 ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               err "Unknown flag: $1"; exit 1 ;;
  esac
done

for c in kubectl helm; do command -v "$c" >/dev/null 2>&1 || { err "Missing required command: $c"; exit 1; }; done
kubectl cluster-info >/dev/null 2>&1 || { err "kubectl can't reach a cluster. Point your context at the target cluster first."; exit 1; }

# --base-domain validation. When supplied it must be a syntactically valid, lowercase
# FQDN (≥2 labels, no scheme/port/path, no trailing dot) so it can stand in for
# *.<domain> wildcard SANs and <org>.<domain> hosts. ACME wildcard issuance has no
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
  [[ "$INSTALL_FLEET_DATABASE" == "0" ]] || _preflight_postgres_bootstrap fleet "$FLEET_POSTGRES_CREDENTIALS_SECRET" "$FLEET_POSTGRES_OWNER"
  _preflight_postgres_bootstrap obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER"
  _preflight_postgres_bootstrap litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER"
  _preflight_postgres_bootstrap langfuse "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_OWNER"
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

  # 2b. Tenant StorageClass encryption (ADVISORY) — tenant state lands on the cluster's
  #     default StorageClass unless --storage-class pins one. At-rest encryption is a
  #     StorageClass/provider concern the deploy script cannot positively verify, so this
  #     only WARNS (never fails): flag when no explicit tenant StorageClass is set so a
  #     multi-CT operator consciously chooses an encrypted/CMEK class (see tenant.storage
  #     .storageClassName) rather than inheriting an unknown default.
  if [[ "$MULTI_CT" == "1" && -z "$STORAGE_CLASS" ]]; then
    warn "Preflight: --multi-ct with no --storage-class — tenant state PVCs will use the cluster default StorageClass, whose at-rest encryption is unverified. Pin an encrypted/CMEK class (--storage-class, or tenant.storage.storageClassName) for multi-tenant isolation."
  fi

  # 3. First-party images pullable — catch a private/typo'd registry before the rollout
  #    sits in ImagePullBackOff. A best-effort manifest check (skopeo/crane/docker) that
  #    only WARNS if no inspector is available (we never block on a missing local tool).
  local _img="ghcr.io/elewa-git/opencrane-clustertenant-manager:${CONTROL_PLANE_TAG:-$IMAGE_TAG}"
  if command -v skopeo >/dev/null 2>&1; then
    skopeo inspect "docker://$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (skopeo inspect failed). Check the registry/tag and your pull credentials.")
  elif command -v crane >/dev/null 2>&1; then
    crane manifest "$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (crane manifest failed). Check the registry/tag and your pull credentials.")
  elif command -v docker >/dev/null 2>&1; then
    docker manifest inspect "$_img" >/dev/null 2>&1 || PF_FAILS+=("First-party image not pullable: $_img (docker manifest inspect failed). Check the registry/tag and your pull credentials.")
  else
    warn "Preflight: no image inspector (skopeo/crane/docker) — skipping the image-pull check."
  fi

  # 4. Registrar NS-delegation for --base-domain — acme orders AND external-dns both hang
  #    if the domain's authoritative name servers are not delegated to the DNS zone. We
  #    only assert it resolves to SOME name servers (an undelegated domain returns none).
  if [[ -n "$BASE_DOMAIN" ]]; then
    if command -v dig >/dev/null 2>&1; then
      [[ -n "$(dig +short NS "$BASE_DOMAIN" 2>/dev/null)" ]] || PF_FAILS+=("No NS delegation resolves for '$BASE_DOMAIN'. Delegate it to your DNS zone's name servers at your registrar (see Terraform output dns_name_servers), or DNS-01 issuance + external-dns will hang.")
    elif command -v host >/dev/null 2>&1; then
      host -t NS "$BASE_DOMAIN" >/dev/null 2>&1 || PF_FAILS+=("No NS delegation resolves for '$BASE_DOMAIN'. Delegate it to your DNS zone's name servers at your registrar, or DNS-01 issuance + external-dns will hang.")
    else
      warn "Preflight: no dig/host — skipping the NS-delegation check for '$BASE_DOMAIN'."
    fi
  fi

  # 5. DNS-write capability — covers BOTH external-dns and the cert-manager DNS-01 solver,
  #    which SHARE one zone-write credential. Only relevant when acme/clouddns is requested
  #    (selfSigned/off write no zone). Acceptable: an external SA-key file (--dns01-credentials)
  #    OR a Workload-Identity GSA bound roles/dns.admin (--dns-writer-gsa, annotating the KSAs).
  #    The check FAILS (never warn-and-pass) when it cannot positively confirm the capability —
  #    a green preflight must mean the actual install will not fail closed on the same input.
  local _is_acme=0
  if [[ "$CERT_MANAGER" == "on" && -n "$ACME_EMAIL" && -n "$DNS01_PROVIDER" ]]; then _is_acme=1; fi
  if [[ "$_is_acme" == "1" ]]; then
    if [[ -n "$DNS01_CREDENTIALS" ]]; then
      [[ -f "$DNS01_CREDENTIALS" ]] || PF_FAILS+=("--dns01-credentials '$DNS01_CREDENTIALS' not found. external-dns + cert-manager DNS-01 share this SA key for zone writes.")
    else
      # Workload-Identity path. The KSAs need the shared DNS-writer GSA to annotate them, so
      # --dns-writer-gsa is required here too (the install fails closed without it).
      if [[ -z "$DNS_WRITER_GSA" ]]; then
        PF_FAILS+=("Workload-Identity DNS writes need the shared DNS-writer GSA. Pass --dns-writer-gsa <gsa>@<project>.iam.gserviceaccount.com (Terraform output dns_writer_service_account_email) so the external-dns + cert-manager KSAs can be annotated, or pass --dns01-credentials for an external zone.")
      fi
      # Workload Identity ENABLED on the cluster — a roles/dns.admin binding is useless if
      # the cluster can't impersonate the GSA. GKE runs the gke-metadata-server DaemonSet in
      # kube-system iff Workload Identity is enabled; its absence is the dead-external-dns
      # root cause (records never written, no auth error — the pod just can't get a token).
      if ! kubectl get ds -n kube-system gke-metadata-server -o name >/dev/null 2>&1; then
        PF_FAILS+=("Workload Identity is NOT enabled on this cluster (no gke-metadata-server DaemonSet in kube-system), so external-dns + cert-manager DNS-01 cannot impersonate the DNS-writer GSA — records silently never get written. Enable it: gcloud container clusters update <cluster> --workload-pool=<project>.svc.id.goog (and node pools --workload-metadata=GKE_METADATA), or pass --dns01-credentials for an external zone.")
      fi
      local _proj="${DNS01_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
      if [[ -z "$_proj" || "$_proj" == "(unset)" ]]; then
        PF_FAILS+=("acme/clouddns DNS-01 needs the GCP project hosting the zone for '$BASE_DOMAIN'. Pass --dns01-project (or set a gcloud active project) so the shared roles/dns.admin binding can be verified.")
      elif command -v gcloud >/dev/null 2>&1; then
        # A roles/dns.admin binding must exist for SOME service account on the project; both
        # external-dns and the cert-manager solver impersonate it via Workload Identity.
        if ! gcloud projects get-iam-policy "$_proj" --flatten="bindings[].members" --format='value(bindings.role)' 2>/dev/null | grep -q "roles/dns.admin"; then
          PF_FAILS+=("No roles/dns.admin binding found on project '$_proj'. Bind it to the shared DNS-writer GSA (external-dns + cert-manager DNS-01 impersonate it): gcloud projects add-iam-policy-binding $_proj --member='serviceAccount:GSA@$_proj.iam.gserviceaccount.com' --role='roles/dns.admin'. Or pass --dns01-credentials for an external zone.")
        fi
      else
        # gcloud absent → we cannot verify the roles/dns.admin binding. FAIL (do not warn-and-pass):
        # a green preflight that hides an unverifiable requirement is worse than a clear blocker.
        PF_FAILS+=("Cannot verify roles/dns.admin on project '$_proj' — gcloud is not installed on this machine. Run the preflight where gcloud is available, or pass --dns01-credentials for an external zone (a file we can check directly).")
      fi
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
# Langfuse stable credentials. SALT, ENCRYPTION_KEY, and API keys MUST remain constant
# after the first deploy — changing them orphans stored trace data and breaks NEXTAUTH
# sessions. Re-use existing values from the secret; only generate fresh ones on first install.
_gen_secret_256() { openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-f0-9' | head -c 64; }
LANGFUSE_NEXTAUTH_SECRET="$(_read_secret opencrane-langfuse NEXTAUTH_SECRET)"
LANGFUSE_NEXTAUTH_SECRET="${LANGFUSE_NEXTAUTH_SECRET:-$(_gen_secret)}"
LANGFUSE_SALT="$(_read_secret opencrane-langfuse SALT)"
LANGFUSE_SALT="${LANGFUSE_SALT:-$(_gen_secret)}"
# ENCRYPTION_KEY must be 256 bits = 64 hex characters.
LANGFUSE_ENCRYPTION_KEY="$(_read_secret opencrane-langfuse ENCRYPTION_KEY)"
LANGFUSE_ENCRYPTION_KEY="${LANGFUSE_ENCRYPTION_KEY:-$(_gen_secret_256)}"
LANGFUSE_PUBLIC_KEY="$(_read_secret opencrane-langfuse LANGFUSE_INIT_PROJECT_PUBLIC_KEY)"
LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-pk-lf-$(_gen_secret | head -c 24)}"
LANGFUSE_SECRET_KEY="$(_read_secret opencrane-langfuse LANGFUSE_INIT_PROJECT_SECRET_KEY)"
LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-sk-lf-$(_gen_secret | head -c 24)}"
LANGFUSE_ADMIN_PASSWORD="$(_read_secret opencrane-langfuse LANGFUSE_INIT_USER_PASSWORD)"
LANGFUSE_ADMIN_PASSWORD="${LANGFUSE_ADMIN_PASSWORD:-$(_gen_secret)}"
# ClickHouse internal password (stable: changing it after init requires manual CH user management).
LANGFUSE_CH_PASSWORD="$(_read_secret opencrane-langfuse CLICKHOUSE_PASSWORD)"
LANGFUSE_CH_PASSWORD="${LANGFUSE_CH_PASSWORD:-$(_gen_secret)}"
# Bitnami sub-subchart passwords inside the Langfuse chart. Bitnami charts require the
# existing password to be re-supplied on every upgrade; we read-or-generate so the upgrade
# never fails regardless of whether Langfuse is enabled. The values are stable after first
# creation because each is read back from the cluster secret before generating a new one.
LANGFUSE_S3_ROOT_PASSWORD="$(_read_secret opencrane-s3 root-password)"
LANGFUSE_S3_ROOT_PASSWORD="${LANGFUSE_S3_ROOT_PASSWORD:-$(_gen_secret)}"
LANGFUSE_REDIS_PASSWORD="$(_read_secret opencrane-redis valkey-password)"
LANGFUSE_REDIS_PASSWORD="${LANGFUSE_REDIS_PASSWORD:-$(_gen_secret)}"

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
[[ "$INSTALL_FLEET_DATABASE" == "0" ]] || _require_postgres_bootstrap fleet "$FLEET_POSTGRES_CREDENTIALS_SECRET" "$FLEET_POSTGRES_OWNER"
_require_postgres_bootstrap obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER"
_require_postgres_bootstrap litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER"
_require_postgres_bootstrap langfuse "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_OWNER"
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

_postgres_api_host_cidr() {
  local address="$1"
  if [[ "$address" == *:* ]]; then
    printf '%s/128' "$address"
  else
    printf '%s/32' "$address"
  fi
}

POSTGRES_KUBERNETES_API_SERVICE_IP="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.clusterIP}')"
POSTGRES_KUBERNETES_API_SERVICE_PORT="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.ports[0].port}')"
POSTGRES_KUBERNETES_API_ENDPOINT_PORT="$(kubectl get endpoints kubernetes -n default -o jsonpath='{.subsets[0].ports[0].port}')"
if [[ -z "$POSTGRES_KUBERNETES_API_SERVICE_IP" || -z "$POSTGRES_KUBERNETES_API_SERVICE_PORT" || -z "$POSTGRES_KUBERNETES_API_ENDPOINT_PORT" ]]; then
  err "Kubernetes API Service and endpoint addresses are required for bounded PostgreSQL pooler egress."
  exit 1
fi
POSTGRES_KUBERNETES_API_ARGS=(
  --set-string "networkPolicy.kubernetesApiServerCidrs[0]=$(_postgres_api_host_cidr "$POSTGRES_KUBERNETES_API_SERVICE_IP")"
  --set "networkPolicy.kubernetesApiServerPort=$POSTGRES_KUBERNETES_API_SERVICE_PORT"
  --set "networkPolicy.kubernetesApiServerEndpointPort=$POSTGRES_KUBERNETES_API_ENDPOINT_PORT")
POSTGRES_KUBERNETES_API_ENDPOINT_INDEX=0
while IFS= read -r postgres_api_endpoint_ip; do
  [[ -z "$postgres_api_endpoint_ip" ]] && continue
  POSTGRES_KUBERNETES_API_ARGS+=(--set-string "networkPolicy.kubernetesApiServerEndpointCidrs[$POSTGRES_KUBERNETES_API_ENDPOINT_INDEX]=$(_postgres_api_host_cidr "$postgres_api_endpoint_ip")")
  POSTGRES_KUBERNETES_API_ENDPOINT_INDEX=$((POSTGRES_KUBERNETES_API_ENDPOINT_INDEX + 1))
done < <(kubectl get endpoints kubernetes -n default -o jsonpath='{range .subsets[*].addresses[*]}{.ip}{"\n"}{end}')
if [[ "$POSTGRES_KUBERNETES_API_ENDPOINT_INDEX" -eq 0 ]]; then
  err "Kubernetes API has no backing endpoints for bounded PostgreSQL pooler egress."
  exit 1
fi

_install_postgres_server() {
  local pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/name":"langfuse"}}]'
  local databases_json="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"langfuse\",\"owner\":\"$LANGFUSE_POSTGRES_OWNER\",\"credentialsSecret\":\"$LANGFUSE_POSTGRES_CREDENTIALS_SECRET\"}]"
  if [[ "$INSTALL_FLEET_DATABASE" == "1" ]]; then
    pooler_client_selectors_json='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/name":"langfuse"}},{"matchLabels":{"app.kubernetes.io/component":"fleet-manager"}}]'
    databases_json="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"langfuse\",\"owner\":\"$LANGFUSE_POSTGRES_OWNER\",\"credentialsSecret\":\"$LANGFUSE_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"fleet\",\"owner\":\"$FLEET_POSTGRES_OWNER\",\"credentialsSecret\":\"$FLEET_POSTGRES_CREDENTIALS_SECRET\"}]"
  fi
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
  for database_resource in "${POSTGRES_RELEASE}-obot" "${POSTGRES_RELEASE}-litellm" "${POSTGRES_RELEASE}-langfuse"; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  done
  if [[ "$INSTALL_FLEET_DATABASE" == "1" ]]; then
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${POSTGRES_RELEASE}-fleet" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  fi
  kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
}

_publish_database_connection() {
  local credentials_secret="$1"
  local app_secret="$2"
  local host="$3"
  local database_name="$4"
  local connection_options="${5:-}"
  local publisher_args=("$NAMESPACE" "$credentials_secret" "$app_secret" "$host" "$database_name")
  if [[ -n "$connection_options" ]]; then
    publisher_args+=("$connection_options")
  fi
  bash "$POSTGRES_CONNECTION_PUBLISHER" \
    "${publisher_args[@]}"
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
LANGFUSE_POSTGRES_APP_SECRET="${POSTGRES_RELEASE}-langfuse-app"
POSTGRES_ADMIN_APP_SECRET="${POSTGRES_RELEASE}-admin"
POSTGRES_POOLER_HOST="${POSTGRES_RELEASE}-pooler"
# The one replica of the OpenCrane server gets five Prisma connections at most.
# This leaves 75 of the 80 physical-server connections outside Prisma's process
# pool and keeps the 50-connection PgBouncer database budget authoritative.
_publish_database_connection "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" opencrane "sslmode=disable&connection_limit=5&pool_timeout=5"
_publish_database_connection "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" obot
_publish_database_connection "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" litellm
_publish_database_connection "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" langfuse
_publish_database_connection "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_APP_SECRET" "$POSTGRES_POOLER_HOST" opencrane
if [[ "$INSTALL_FLEET_DATABASE" == "1" ]]; then
  FLEET_POSTGRES_APP_SECRET="${POSTGRES_RELEASE}-fleet-app"
  _publish_database_connection "$FLEET_POSTGRES_CREDENTIALS_SECRET" "$FLEET_POSTGRES_APP_SECRET" "$POSTGRES_POOLER_HOST" fleet
fi

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
if [[ "$INSTALL_FLEET_DATABASE" == "1" ]]; then
  _assert_distinct_cnpg_app_credentials "$POSTGRES_APP_SECRET" "$FLEET_POSTGRES_APP_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET"
else
  _assert_distinct_cnpg_app_credentials "$POSTGRES_APP_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET"
fi

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

# Langfuse secret. Contains stable credentials for the in-cluster Langfuse subchart.
# SALT, ENCRYPTION_KEY, and API keys MUST be stable once set.
kubectl create secret generic opencrane-langfuse -n "$NAMESPACE" \
  --from-literal=NEXTAUTH_SECRET="$LANGFUSE_NEXTAUTH_SECRET" \
  --from-literal=SALT="$LANGFUSE_SALT" \
  --from-literal=ENCRYPTION_KEY="$LANGFUSE_ENCRYPTION_KEY" \
  --from-literal=CLICKHOUSE_PASSWORD="$LANGFUSE_CH_PASSWORD" \
  --from-literal=LANGFUSE_INIT_PROJECT_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY" \
  --from-literal=LANGFUSE_INIT_PROJECT_SECRET_KEY="$LANGFUSE_SECRET_KEY" \
  --from-literal=LANGFUSE_INIT_USER_PASSWORD="$LANGFUSE_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# OIDC secret. The chart references clustertenantManager.oidc.existingSecret for the client + session
# secrets; previously this installer set only the issuer/clientId/redirect and ASSUMED the
# Secret already existed, so a fresh OIDC install crash-looped on a missing Secret. Create it
# here when OIDC is configured: the client secret is required (a confidential client can't
# authenticate without it); the session secret signs login cookies and is auto-generated when
# not supplied. Idempotent (dry-run | apply), so re-runs converge.
if [[ -n "$OIDC_ISSUER_URL" ]]; then
  if [[ -z "$OIDC_CLIENT_SECRET" ]]; then
    err "OIDC is configured (--oidc-issuer-url set) but no client secret was provided. Pass --oidc-client-secret (or OPENCRANE_OIDC_CLIENT_SECRET) — a confidential client cannot authenticate without it."
    exit 1
  fi
  OIDC_SESSION_SECRET="${OIDC_SESSION_SECRET:-$(_gen_secret)}"
  log "Creating the OIDC secret '$OIDC_SECRET_NAME' (client + session secret)…"
  kubectl create secret generic "$OIDC_SECRET_NAME" -n "$NAMESPACE" \
    --from-literal=OIDC_CLIENT_SECRET="$OIDC_CLIENT_SECRET" \
    --from-literal=OIDC_SESSION_SECRET="$OIDC_SESSION_SECRET" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# 2.25. ingress-nginx (a cluster singleton). Installed by default; auto-skips when a
# controller is already present (existing IngressClass or an ingress-nginx Deployment)
# so bundling never clobbers a BYO controller. helm upgrade --install is itself
# idempotent, but we check first so a BYO controller in another namespace is respected.
_ingress_nginx_present() {
  kubectl get ingressclass -o name 2>/dev/null | grep -q . && return 0
  kubectl get deploy -A -l app.kubernetes.io/name=ingress-nginx -o name 2>/dev/null | grep -q . && return 0
  return 1
}

_install_ingress_nginx() {
  if [[ "$INSTALL_INGRESS_NGINX" != "1" ]]; then
    log "ingress-nginx: bundling disabled (--no-ingress-nginx). Bring your own controller."
    return
  fi
  if _ingress_nginx_present; then
    log "ingress-nginx: a controller is already present — skipping the bundled install."
    return
  fi
  log "Installing ingress-nginx controller…"
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update >/dev/null
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace "$INGRESS_NGINX_NAMESPACE" --create-namespace --wait
}

_install_ingress_nginx

# 2.30. Auto-derive ingress.externalIp from the ingress-nginx LoadBalancer (opt-in,
# --auto-ingress-ip). The operator's per-org DNS side effect needs the cluster ingress IP;
# rather than hand-copy it from `kubectl get svc`, derive it here once the controller's LB is
# assigned and feed it into the chart as a --set. An explicit ingress.externalIp --set wins.
_resolve_ingress_ip() {
  [[ "$AUTO_INGRESS_IP" == "1" ]] || return 0
  if printf '%s\n' "${EXTRA_SET[@]}" | grep -q "ingress.externalIp="; then
    log "Auto-ingress-ip: ingress.externalIp set explicitly — skipping derivation."
    return 0
  fi
  log "Auto-ingress-ip: waiting for the ingress-nginx LoadBalancer address…"
  local sel="app.kubernetes.io/name=ingress-nginx,app.kubernetes.io/component=controller"
  local ip="" tries=0
  while (( tries < 60 )); do
    ip="$(kubectl get svc -n "$INGRESS_NGINX_NAMESPACE" -l "$sel" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null)"
    [[ -z "$ip" ]] && ip="$(kubectl get svc -n "$INGRESS_NGINX_NAMESPACE" -l "$sel" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2>/dev/null)"
    [[ -n "$ip" ]] && break
    sleep 5; tries=$((tries+1))
  done
  if [[ -z "$ip" ]]; then
    warn "Auto-ingress-ip: no LoadBalancer address after ~5m; leaving ingress.externalIp unset (per-org DNS records stay unwritten until it is set)."
    return 0
  fi
  log "Auto-ingress-ip: derived ingress.externalIp=$ip from the ingress-nginx LB."
  EXTRA_SET+=(--set "ingress.externalIp=$ip")
}
_resolve_ingress_ip

# 2.35. external-dns (a cluster singleton). The operator declares per-org records as
# namespaced DNSEndpoint CRs; the external-dns controller (run with --source=crd)
# reconciles them into Google Cloud DNS. It needs zone-WRITE access, so it shares the
# cert-manager DNS-01 zone + credentials exactly:
#   - Workload Identity (no --dns01-credentials): the SAME GSA bound roles/dns.admin that
#     the cert-manager solver impersonates. We DO NOT create a second binding — the
#     DNS-01 preflight (Step 2.5) already fails closed unless that binding exists.
#   - External zone (--dns01-credentials FILE): the SAME SA-key, mounted as a Secret.
# external-dns is therefore only bundled in acme/clouddns mode (off/selfSigned have no
# managed zone to write). Installed AFTER Step 2.5 so DNS01_PROJECT / DNS01_CREDENTIALS
# are already resolved + validated. Gated by externalDns.install (--no-external-dns to BYO).
_external_dns_present() {
  kubectl get deploy -A -l app.kubernetes.io/name=external-dns -o name 2>/dev/null | grep -q . && return 0
  return 1
}

_install_external_dns() {
  if [[ "$INSTALL_EXTERNAL_DNS" != "1" ]]; then
    log "external-dns: bundling disabled (--no-external-dns). Bring your own controller."
    return
  fi
  if [[ "$CERT_MODE" != "acme" ]]; then
    log "external-dns: skipped (no managed DNS zone in mode='$CERT_MODE'; bundled only in acme/clouddns mode). The operator's DNSEndpoint CRs are reconciled by a BYO controller if you run one."
    return
  fi
  if _external_dns_present; then
    log "external-dns: a controller is already present — skipping the bundled install."
    return
  fi
  log "Installing external-dns controller (--source=crd → Cloud DNS, zone for '$BASE_DOMAIN')…"
  helm repo add external-dns https://kubernetes-sigs.github.io/external-dns --force-update >/dev/null

  # external-dns flags: reconcile DNSEndpoint CRs (--source=crd, with its CRD installed)
  # into Google Cloud DNS, scoped to --base-domain so it never touches records outside the
  # platform zone, against the same project as the cert-manager solver.
  local ed_args=(upgrade --install external-dns external-dns/external-dns
    --namespace "$EXTERNAL_DNS_NAMESPACE" --create-namespace --wait
    --set "provider=google"
    --set-string "google.project=$DNS01_PROJECT"
    --set "sources={crd}"
    --set "installCRDs=true"
    --set-string "domainFilters={$BASE_DOMAIN}"
    --set "policy=sync")

  if [[ -n "$DNS01_CREDENTIALS" ]]; then
    # External-zone path: SHARE the cert-manager solver Secret's SA key. external-dns reads
    # GCP creds from a file, so we create the key Secret in its namespace and mount it.
    kubectl create secret generic clouddns-external-dns \
      -n "$EXTERNAL_DNS_NAMESPACE" \
      --from-file=credentials.json="$DNS01_CREDENTIALS" \
      --dry-run=client -o yaml | kubectl apply -f -
    ed_args+=(--set-string "google.serviceAccountSecret=clouddns-external-dns"
      --set-string "google.serviceAccountSecretKey=credentials.json")
  else
    # Workload Identity path: external-dns impersonates the SAME GSA the cert-manager DNS-01
    # solver does (roles/dns.admin). Terraform creates the WI BINDING, but the controller's
    # KSA must still carry the `iam.gke.io/gcp-service-account` annotation or the metadata-server
    # handshake falls back to the node SA and Cloud DNS writes fail at runtime. Require the GSA
    # here (fail closed) rather than installing a controller that silently cannot authenticate.
    if [[ -z "$DNS_WRITER_GSA" ]]; then
      err "external-dns Workload Identity needs the shared DNS-writer GSA to annotate its ServiceAccount."
      err "Pass --dns-writer-gsa <gsa>@<project>.iam.gserviceaccount.com (Terraform output dns_writer_service_account_email),"
      err "or --no-external-dns to BYO a controller, or --dns01-credentials <sa-key.json> for an external zone."
      exit 1
    fi
    log "external-dns: Workload Identity via the shared DNS-writer GSA '$DNS_WRITER_GSA' (roles/dns.admin on '$DNS01_PROJECT')."
    ed_args+=(--set-string "serviceAccount.annotations.iam\.gke\.io/gcp-service-account=$DNS_WRITER_GSA")
  fi
  helm "${ed_args[@]}"
}

# 2.5. cert-manager / TLS. MUST run before the chart's `helm install`: the chart
# renders cert-manager.io/v1 Issuer + Certificate objects, so the CRDs (and, for acme,
# a live webhook) have to exist first or the API server rejects the chart with a 400.
# CERT_MANAGER_HELM_FLAGS is appended to the chart's helm args further down.
CERT_MANAGER_HELM_FLAGS=()

# Resolve the effective mode: off (default), selfSigned (--cert-manager only), or
# acme (--cert-manager + --acme-email + --dns01-provider). A partial acme request is a
# hard error here so we never fall back to selfSigned behind the operator's back.
_resolve_cert_mode() {
  if [[ "$CERT_MANAGER" != "on" ]]; then echo "off"; return; fi
  if [[ -z "$ACME_EMAIL" && -z "$DNS01_PROVIDER" ]]; then echo "selfSigned"; return; fi
  if [[ -n "$ACME_EMAIL" && -n "$DNS01_PROVIDER" ]]; then
    # A wildcard cert (*.<domain>) is meaningless without the base domain, so require it
    # up front rather than letting cert-manager issue against an empty/placeholder SAN.
    if [[ -z "$BASE_DOMAIN" ]]; then
      err "acme TLS issues a wildcard for *.<base-domain>, so --base-domain is required in acme mode."
      exit 1
    fi
    echo "acme"; return
  fi
  err "acme TLS needs BOTH --acme-email and --dns01-provider (got only one). For dev/self-signed TLS drop both and pass --cert-manager alone."
  exit 1
}

# Install the cert-manager controller + CRDs from its upstream chart. Idempotent:
# helm upgrade --install no-ops when
# cert-manager is already present, so bundling it can never clobber an existing one. In the
# acme/Workload-Identity path the controller SA is annotated with the SHARED DNS-writer GSA
# (same one external-dns uses) so the DNS-01 solver can write to the zone; Terraform creates
# the WI binding, but the KSA annotation is the install-time half of the handshake.
_install_cert_manager() {
  log "Installing cert-manager (CRDs + controller)…"
  helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
  local cm_args=(upgrade --install cert-manager jetstack/cert-manager
    --namespace "$CERT_MANAGER_NAMESPACE" --create-namespace --wait
    --set crds.enabled=true)
  if [[ "$CERT_MODE" == "acme" && -z "$DNS01_CREDENTIALS" && -n "$DNS_WRITER_GSA" ]]; then
    cm_args+=(--set-string "serviceAccount.annotations.iam\.gke\.io/gcp-service-account=$DNS_WRITER_GSA")
  fi
  helm "${cm_args[@]}"
}

# DNS-01 preflight (acme only). FAILS FAST with the exact remediation rather than
# letting cert-manager spin on a SOLVING order forever. Two paths:
#   - Workload Identity (no --dns01-credentials): the cert-manager SA's bound GSA needs
#     roles/dns.admin on the zone's project; print the exact gcloud binding command.
#   - External zone (--dns01-credentials FILE): require the file and create the solver
#     Secret in the cert-manager namespace (cert-manager reads ClusterIssuer solver
#     Secrets only from its OWN namespace).
_preflight_dns01() {
  # 1. clouddns is the only provider this installer wires end-to-end; reject others up
  #    front so the failure is a clear message, not a later cert-manager order error.
  if [[ "$DNS01_PROVIDER" != "clouddns" ]]; then
    err "Unsupported --dns01-provider '$DNS01_PROVIDER'. This installer wires 'clouddns' (Google Cloud DNS). For another provider, install cert-manager yourself and set certManager.acme.dns01.{provider,config} in a --values file."
    exit 1
  fi

  # The clouddns solver requires the GCP project that hosts the zone for --base-domain.
  # Default it from the gcloud active project; FAIL FAST if still empty (a solver with no
  # project never issues, and we tie the issuer zone to the same install input as the chart).
  if [[ -z "$DNS01_PROJECT" ]]; then
    DNS01_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  fi
  if [[ -z "$DNS01_PROJECT" || "$DNS01_PROJECT" == "(unset)" ]]; then
    err "clouddns DNS-01 needs the GCP project that hosts the Cloud DNS zone for '$BASE_DOMAIN'. Pass --dns01-project PROJECT_ID (or set a gcloud active project)."
    exit 1
  fi

  if [[ -n "$DNS01_CREDENTIALS" ]]; then
    # 2a. External-zone path: the SA-key file MUST exist; create the solver Secret the
    #     ClusterIssuer references. Failing here is preferable to a green install whose
    #     wildcard cert never issues because the solver has no credentials.
    if [[ ! -f "$DNS01_CREDENTIALS" ]]; then
      err "--dns01-credentials '$DNS01_CREDENTIALS' not found. Provide the Cloud DNS service-account key JSON, or omit it to use GKE Workload Identity."
      exit 1
    fi
    log "Creating Cloud DNS solver Secret in the '$CERT_MANAGER_NAMESPACE' namespace…"
    kubectl create secret generic clouddns-dns01-solver \
      -n "$CERT_MANAGER_NAMESPACE" \
      --from-file=key.json="$DNS01_CREDENTIALS" \
      --dry-run=client -o yaml | kubectl apply -f -
  elif [[ -n "$DNS_WRITER_GSA" ]]; then
    # 2b. Workload Identity path WITH the shared DNS-writer GSA: the cert-manager controller
    #     SA is annotated with this GSA in _install_cert_manager, completing the handshake for
    #     the SAME identity external-dns uses. We trust Terraform created the roles/dns.admin
    #     binding (the `--preflight` check verifies it where gcloud is available); here we only
    #     confirm the GSA was supplied so the solver has an identity to impersonate.
    log "DNS-01 via Workload Identity using the shared DNS-writer GSA '$DNS_WRITER_GSA' (roles/dns.admin on '$DNS01_PROJECT')."
  else
    # 2c. No credential at all: FAIL CLOSED. Without either an external SA key or the shared
    #     DNS-writer GSA the solver has no identity, so the wildcard order would spin forever.
    err "DNS-01 needs a zone-write identity: either the shared DNS-writer GSA (Workload Identity) or an external SA key."
    err "Pass --dns-writer-gsa <gsa>@$DNS01_PROJECT.iam.gserviceaccount.com (Terraform output dns_writer_service_account_email; it must have roles/dns.admin),"
    err "or --dns01-credentials <sa-key.json> for an external DNS zone."
    exit 1
  fi
}

CERT_MODE="$(_resolve_cert_mode)"
case "$CERT_MODE" in
  off)
    log "TLS: cert-manager disabled (mode=off). The chart renders no issuer/cert."
    ;;
  selfSigned)
    log "TLS: cert-manager self-signed issuer (dev/k3d/IP — not browser-trusted)."
    _install_cert_manager
    CERT_MANAGER_HELM_FLAGS+=(--set "certManager.enabled=true" --set "certManager.mode=selfSigned")
    ;;
  acme)
    log "TLS: cert-manager ACME / DNS-01 ($DNS01_PROVIDER) — browser-trusted wildcard."
    _install_cert_manager
    # Wait on the webhook BEFORE rendering the chart's issuer/cert: cert-manager's
    # validating webhook rejects cert-manager.io/v1 objects with a 400 until it is live,
    # which would fail the chart install with a confusing connection error.
    log "Waiting for the cert-manager webhook to become ready…"
    kubectl rollout status deploy/cert-manager-webhook -n "$CERT_MANAGER_NAMESPACE" --timeout="${TIMEOUT}s"
    _preflight_dns01
    # cluster-issuer.yaml fail-closes without BOTH acme.email and dns01.provider, so both
    # are always set here. The clouddns solver config is rendered verbatim under
    # solvers[].dns01.clouddns; an external zone references the solver Secret created above.
    CERT_MANAGER_HELM_FLAGS+=(--set "certManager.enabled=true" --set "certManager.mode=acme")
    CERT_MANAGER_HELM_FLAGS+=(--set-string "certManager.acme.email=$ACME_EMAIL")
    CERT_MANAGER_HELM_FLAGS+=(--set "certManager.acme.dns01.provider=$DNS01_PROVIDER")
    # The clouddns solver project (resolved/validated in _preflight_dns01) ties the cert
    # issuer's DNS zone to the same install input that drives the chart + Terraform.
    CERT_MANAGER_HELM_FLAGS+=(--set-string "certManager.acme.dns01.config.project=$DNS01_PROJECT")
    if [[ -n "$DNS01_CREDENTIALS" ]]; then
      CERT_MANAGER_HELM_FLAGS+=(--set "certManager.acme.dns01.config.serviceAccountSecretRef.name=clouddns-dns01-solver")
      CERT_MANAGER_HELM_FLAGS+=(--set-string "certManager.acme.dns01.config.serviceAccountSecretRef.key=key.json")
    fi
    ;;
esac

# external-dns is bundled here — after Step 2.5 resolved CERT_MODE + the shared DNS-01
# project/credentials it reuses. When it (or a BYO controller) is in place, tell the chart
# to switch the operator's DNSEndpoint declaration ON so per-org records are reconciled.
_install_external_dns
EXTERNAL_DNS_HELM_FLAGS=()
if [[ "$CERT_MODE" == "acme" ]] && { [[ "$INSTALL_EXTERNAL_DNS" == "1" ]] || _external_dns_present; }; then
  EXTERNAL_DNS_HELM_FLAGS+=(--set "externalDns.enabled=true")
fi

# 3. The OpenCrane chart.
# Fetch subchart dependencies (Langfuse, and any others declared in Chart.yaml) — from Chart.lock,
# NOT by re-resolving the version constraints. `helm dep build` rebuilds charts/ to exactly the
# versions the committed Chart.lock pins, so a deploy ships the SAME subcharts CI validated and never
# silently drifts to a newer langfuse (the dependency is pinned to an exact version in Chart.yaml).
# It also won't rewrite the vendored Chart.lock/.tgz on every run the way `dep update` does. Bumping a
# dependency is a deliberate edit (change Chart.yaml + run `helm dep update` once + commit the lock).
log "Adding Langfuse Helm repository…"
helm repo add langfuse https://langfuse.github.io/langfuse-k8s --force-update >/dev/null
log "Fetching chart dependencies (from Chart.lock)…"
helm dep build "$CHART_DIR"

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
  --set-string "clustertenantManager.database.existingSecret=$POSTGRES_APP_SECRET"
  --set-string "clustertenantManager.database.secretKey=uri"
  --set-string "litellm.existingDatabaseSecret=$LITELLM_DATABASE_SECRET"
  --set-string "litellm.databaseSecretKey=DATABASE_URL"
  --set-string "artifactService.persistence.storageClass=$ARTIFACT_STORAGE_CLASS"
  --set-string "artifactService.namespace=$ARTIFACT_NAMESPACE"
  --set-string "artifactService.keys.catalogExistingSecret=$ARTIFACT_CATALOG_KEY_SECRET"
  --set-string "artifactService.keys.serviceExistingSecret=$ARTIFACT_SERVICE_KEY_SECRET"
  --set "litellm.existingSecret=opencrane-litellm")
if [[ "$INSTALL_FLEET_DATABASE" == "1" ]]; then
  helm_args+=(
    --set-string "fleetManager.database.existingSecret=$FLEET_POSTGRES_APP_SECRET"
    --set-string "fleetManager.database.secretKey=uri")
fi

# Pinned-tag float guard: detect if the prior release pinned component images to a specific
# tag. If this invocation does not restate them (no --opencrane-server-tag/--operator-tag/--tenant-tag),
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
  local prior_cp prior_op prior_tn prior_vals
  prior_vals="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null || echo '{}')"

  # Extract tags using jq if available, otherwise fall back to grep.
  if command -v jq >/dev/null 2>&1; then
    prior_cp="$(echo "$prior_vals" | jq -r '.clustertenantManager.image.tag // empty')"
    prior_op="$(echo "$prior_vals" | jq -r '.fleetManager.image.tag // empty')"
    prior_tn="$(echo "$prior_vals" | jq -r '.tenant.image.tag // empty')"
  else
    # Grep fallback for when jq is not available (simple pattern, may miss nested structures).
    prior_cp="$(echo "$prior_vals" | grep -o '"clustertenantManager":[^}]*"tag":"[^"]*' | grep -o '"tag":"[^"]*' | head -1 | cut -d'"' -f4 || true)"
    prior_op="$(echo "$prior_vals" | grep -o '"fleetManager":[^}]*"tag":"[^"]*' | grep -o '"tag":"[^"]*' | head -1 | cut -d'"' -f4 || true)"
    prior_tn="$(echo "$prior_vals" | grep -o '"tenant":[^}]*"tag":"[^"]*' | grep -o '"tag":"[^"]*' | head -1 | cut -d'"' -f4 || true)"
  fi

  local need_warn=0
  # If prior release had a tag and this run doesn't set one, re-pin it.
  if [[ -n "$prior_cp" && -z "$CONTROL_PLANE_TAG" ]]; then
    warn "Prior release had clustertenantManager.image.tag='$prior_cp' — re-pinning (to avoid silent float to chart-default). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to float intentionally."
    CONTROL_PLANE_TAG="$prior_cp"
    need_warn=1
  fi
  if [[ -n "$prior_op" && -z "$OPERATOR_TAG" ]]; then
    warn "Prior release had fleetManager.image.tag='$prior_op' — re-pinning (to avoid silent float to chart-default). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to float intentionally."
    OPERATOR_TAG="$prior_op"
    need_warn=1
  fi
  if [[ -n "$prior_tn" && -z "$TENANT_TAG" ]]; then
    warn "Prior release had tenant.image.tag='$prior_tn' — re-pinning (to avoid silent float to chart-default). Pass OPENCRANE_ALLOW_TAG_FLOAT=1 to float intentionally."
    TENANT_TAG="$prior_tn"
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
OP_TAG="${OPERATOR_TAG:-$IMAGE_TAG}"
TN_TAG="${TENANT_TAG:-$IMAGE_TAG}"
# --set-string: a tag like "1.2.3" or a numeric-looking sha must never be YAML-coerced
# (same guideline as the OIDC string values below; see the deploy ledger).
[[ -n "$CP_TAG" ]] && helm_args+=(--set-string "clustertenantManager.image.tag=$CP_TAG")
[[ -n "$OP_TAG" ]] && helm_args+=(--set-string "fleetManager.image.tag=$OP_TAG")
[[ -n "$TN_TAG" ]] && helm_args+=(--set-string "tenant.image.tag=$TN_TAG")
# --base-domain drives ingress.domain; controlPlaneHost defaults to platform.<domain>
# in the chart, and the cert-manager wildcard SANs (*.<domain>, <domain>,
# controlPlaneHost) are derived from it. Setting it explicitly here keeps a single
# source of truth across the chart, the issuer, and the operator's per-org provisioning.
[[ -n "$BASE_DOMAIN" ]] && helm_args+=(--set "ingress.domain=$BASE_DOMAIN")
# Langfuse has its own database and role on this ClusterTenant's shared PostgreSQL server.
# It never receives the OpenCrane, Obot, or LiteLLM credential.
helm_args+=(--set-string "langfuse.postgresql.host=${POSTGRES_POOLER_HOST}.${NAMESPACE}.svc.cluster.local")
helm_args+=(--set-string "langfuse.postgresql.auth.username=$LANGFUSE_POSTGRES_OWNER")
helm_args+=(--set-string "langfuse.postgresql.auth.existingSecret=$LANGFUSE_POSTGRES_APP_SECRET")
helm_args+=(--set-string "langfuse.postgresql.auth.secretKeys.userPasswordKey=password")
helm_args+=(--set-string "langfuse.postgresql.auth.secretKeys.adminPasswordKey=password")
helm_args+=(--set-string "langfuse.postgresql.auth.database=langfuse")
helm_args+=(--set "langfuse.s3.auth.rootPassword=$LANGFUSE_S3_ROOT_PASSWORD")
helm_args+=(--set "global.valkey.password=$LANGFUSE_REDIS_PASSWORD")
helm_args+=(--set "langfuse.clickhouse.auth.password=$LANGFUSE_CH_PASSWORD")
# Bitnami sub-subchart conditions default to deploy:true in the Langfuse chart even
# when langfuse.inCluster.enabled=false; pass passwords unconditionally so Bitnami's
# upgrade password-validation templates are satisfied regardless of Langfuse state.
[[ -n "$BASE_DOMAIN" ]] && helm_args+=(--set-string "langfuse.langfuse.nextauth.url=https://langfuse.${BASE_DOMAIN}")
# OIDC human-login (opencrane-ui silo). Rendered iff an issuer URL is given; otherwise
# the chart emits no OIDC env and the opencrane-ui stays in token/development mode.
# --set-string (NOT --set): a large numeric Zitadel clientId passed via --set is YAML-parsed
# as a float and rendered in scientific notation (e.g. 3.78…e+17) → Zitadel App.NotFound and
# all login breaks. Strings stay strings (issue #100).
[[ -n "$OIDC_ISSUER_URL" ]]   && helm_args+=(--set-string "clustertenantManager.oidc.issuerUrl=$OIDC_ISSUER_URL")
[[ -n "$OIDC_CLIENT_ID" ]]    && helm_args+=(--set-string "clustertenantManager.oidc.clientId=$OIDC_CLIENT_ID")
[[ -n "$OIDC_REDIRECT_URI" ]] && helm_args+=(--set-string "clustertenantManager.oidc.redirectUri=$OIDC_REDIRECT_URI")
# Point the chart at the Secret created above (client + session secret) instead of leaving
# its inline values empty — keeps secrets out of Helm values + the rendered manifest.
[[ -n "$OIDC_ISSUER_URL" ]]   && helm_args+=(--set-string "clustertenantManager.oidc.existingSecret=$OIDC_SECRET_NAME")
# Platform-operator bootstrap (seed email AND/OR IdP group mapping). The operator identity
# is PLANE-AGNOSTIC, so forward it to BOTH the fleet plane and the opencrane-ui silo —
# previously only the silo received it, so the fleet (super-admin) UI was inaccessible to
# everyone even with a seed set (issue #100). Set ONLY when non-empty; empty → fail-closed.
if [[ -n "$PLATFORM_OPERATOR_SEED_EMAIL" ]]; then
  helm_args+=(--set-string "fleetManager.oidc.platformOperatorSeedEmail=$PLATFORM_OPERATOR_SEED_EMAIL")
  helm_args+=(--set-string "clustertenantManager.oidc.platformOperatorSeedEmail=$PLATFORM_OPERATOR_SEED_EMAIL")
  warn "Seeding platform operator for the cluster (verified OIDC email match). Remove the seed once a group mapping is in place."
fi
if [[ -n "$PLATFORM_OPERATOR_GROUPS" ]]; then
  helm_args+=(--set-string "fleetManager.oidc.platformOperatorGroups=$PLATFORM_OPERATOR_GROUPS")
  helm_args+=(--set-string "clustertenantManager.oidc.platformOperatorGroups=$PLATFORM_OPERATOR_GROUPS")
fi
[[ -n "$VALUES_FILE" ]] && helm_args+=(--values "$VALUES_FILE")
# cert-manager flags resolved in Step 2.5 (empty in mode=off). Placed before --set
# overrides so an operator can still override individual issuer fields on the CLI.
[ ${#CERT_MANAGER_HELM_FLAGS[@]} -gt 0 ] && helm_args+=("${CERT_MANAGER_HELM_FLAGS[@]}")
# external-dns wiring resolved above (empty unless a controller is in place). Placed before
# --set overrides so an operator can still override externalDns.* on the CLI.
[ ${#EXTERNAL_DNS_HELM_FLAGS[@]} -gt 0 ] && helm_args+=("${EXTERNAL_DNS_HELM_FLAGS[@]}")
helm_args+=("${EXTRA_SET[@]}")
# Raw helm-arg passthrough for sanctioned one-time fixes (e.g. --take-ownership).
[[ ${#EXTRA_HELM_ARGS[@]} -gt 0 ]] && helm_args+=("${EXTRA_HELM_ARGS[@]}")
# Value-preservation mode. Helm's DEFAULT on upgrade drops any value a prior release set
# via --set/-f that this invocation does not restate, silently reverting it to the chart
# default — a footgun that broke a live silo once (a pure `--opencrane-server-tag` bump reverted
# ingress.sameOrigin/tls.secretName/gatewayProxy/tenant.gateway.trustedProxies/resource limits;
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

# Read the ACTUAL opencrane-ui host(s) off the deployed ingress(es). Never assume platform.<base>:
# the fleet may serve the apex (controlPlaneHost=<base>), a silo serves <org>.<base>, and only the
# unset default is platform.<base>. Ask the cluster what was rendered; fall back to platform.<base>
# when no ingress exposes a host (e.g. ingress disabled) so callers still get a sensible hint.
_control_plane_hosts() {
  local hosts
  hosts="$(kubectl get ingress -n "$NAMESPACE" \
    -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}' 2>/dev/null \
    | grep -v '^$' | sort -u)"
  if [[ -n "$hosts" ]]; then
    echo "$hosts"
  elif [[ -n "$BASE_DOMAIN" ]]; then
    echo "platform.$BASE_DOMAIN"
  fi
}

# 5. Post-deploy verify (opt-in, --verify). Advisory only — surfaces the failure modes that
# leave a "green" install unreachable (pods not Running, no DNSEndpoints, external-dns auth
# errors, host not resolving) so they are caught here instead of in a confused browser session.
_post_deploy_verify() {
  [[ "$VERIFY" == "1" ]] || return 0
  log "Post-deploy verify (advisory — does not fail the install):"

  # 1. Core pods Running — a CrashLoop/ImagePullBackOff that helm --wait didn't catch.
  local notready
  notready="$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running,status.phase!=Succeeded -o name 2>/dev/null | grep -c . || true)"
  if [[ "$notready" == "0" ]]; then
    log "  ✓ all pods Running/Succeeded in $NAMESPACE"
  else
    warn "  ✗ $notready pod(s) not Running in $NAMESPACE — kubectl get pods -n $NAMESPACE"
  fi

  # 2. DNSEndpoint CRs — the operator's per-org record side effect (only meaningful when the
  #    external-dns CRD source is installed). Absent CRD ⇒ per-org hosts never get A records.
  if kubectl get crd dnsendpoints.externaldns.k8s.io >/dev/null 2>&1; then
    local des
    des="$(kubectl get dnsendpoint -A -o name 2>/dev/null | grep -c . || true)"
    log "  • DNSEndpoint CRs present: $des"
  else
    warn "  • DNSEndpoint CRD absent (external-dns --source=crd not installed) — per-org A records won't be written."
  fi

  # 3. external-dns recent auth/permission errors — the dead-external-dns failure mode (the
  #    controller runs but can't write the zone, so records silently never appear).
  if kubectl get deploy -A -l app.kubernetes.io/name=external-dns -o name 2>/dev/null | grep -q .; then
    if kubectl logs -A -l app.kubernetes.io/name=external-dns --tail=200 2>/dev/null | grep -qiE "permission|forbidden|invalid_grant|denied|failed to (apply|submit)"; then
      warn "  ✗ external-dns logs show recent errors — kubectl logs -A -l app.kubernetes.io/name=external-dns --tail=200"
    else
      log "  ✓ external-dns logs show no recent auth errors"
    fi
  fi

  # 4. Control-plane host(s) resolve to the ingress — the end of the chain a user hits first.
  #    Read the rendered host(s) off the ingress so the apex / org host is checked, not platform.<base>.
  if command -v dig >/dev/null 2>&1; then
    local host resolved
    for host in $(_control_plane_hosts); do
      resolved="$(dig +short "$host" 2>/dev/null | tail -1)"
      if [[ -n "$resolved" ]]; then
        log "  ✓ $host resolves to $resolved"
      else
        warn "  ✗ $host does not resolve yet (DNS propagation lag or a missing record)."
      fi
    done
  fi
}
_post_deploy_verify

log "Done. OpenCrane is installed in namespace '$NAMESPACE'."
_cp_hosts="$(_control_plane_hosts)"
if [[ -n "$_cp_hosts" ]]; then
  log "Point your DNS at the ingress, then visit:"
  while IFS= read -r _h; do [[ -n "$_h" ]] && log "  https://$_h"; done <<< "$_cp_hosts"
fi
log "Ingress: kubectl get ingress -n $NAMESPACE"
