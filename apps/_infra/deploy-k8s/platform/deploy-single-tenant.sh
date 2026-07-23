#!/usr/bin/env bash
# =============================================================================
# OpenCrane — SINGLE-TENANT deploy (orchestrates the two per-role charts)
#
# Installs a one-organisation platform on the cluster your kubectl context points at.
# Since the chart split (Option 2) there is no single co-located chart — a single-tenant
# install is the FLEET chart + ONE SILO chart, driven here in two passes:
#
#   1. FLEET chart (fleet-platform): cluster bootstrap (CRDs, cert-manager issuer,
#      external-secrets, otel, monitoring, docs, main-network default-deny) + the
#      fleet-manager, with self-service OFF and exactly ONE ClusterTenant SEEDED. The
#      fleet operator reconciles that CR and binds the org namespace `opencrane-<org>`.
#      The fleet-operator/fleet-platform surface moved to the WeOwnAI repo (see
#      elewa-git/opencrane#150) — point FLEET_CHART_DIR at a checked-out copy of that
#      repo's fleet-platform chart (e.g. ../weownai/apps/fleet-platform).
#   2. SILO chart (apps/_infra/deploy-k8s): the org's opencrane-ui + runtime planes,
#      installed into `opencrane-<org>` (delegated to that app's deploy.sh).
#
# Both passes run through the shared engine (apps/_infra/deploy-k8s/platform/k8s-deploy.sh) so cluster
# work cannot diverge; this script only presets the single-tenant value flags + ordering.
#
# Usage:
#   FLEET_CHART_DIR=/path/to/weownai/apps/fleet-platform \
#   apps/_infra/deploy-k8s/platform/deploy-single-tenant.sh \
#       --base-domain dev.opencrane.ai \
#       --org-name acme --org-owner-email owner@acme.example \
#       [--org-display-name "Acme Inc"] [--org-tier shared|dedicatedNodes|dedicatedCluster] \
#       [ANY k8s-deploy.sh flag, e.g. --cert-manager --acme-email … --dns01-provider clouddns]
#
# --base-domain, --org-name and --org-owner-email are required (the org cannot be seeded
# without an identity + a name + a domain to serve it at).
#
# Prereqs: kubectl (pointed at the target cluster), helm, and a checked-out fleet-platform
# chart (FLEET_CHART_DIR) — that chart no longer lives in this repo.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CORE="$SCRIPT_DIR/k8s-deploy.sh"
FLEET_CHART="${FLEET_CHART_DIR:-}"
SILO_DEPLOY="$REPO_ROOT/apps/_infra/deploy-k8s/deploy.sh"



ORG_NAME=""
ORG_DISPLAY_NAME=""
ORG_OWNER_EMAIL=""
ORG_TIER="shared"
BASE_DOMAIN="${OPENCRANE_BASE_DOMAIN:-}"
PASSTHROUGH=()
PROVISION=""        # optional: local|gke|vps — provision a cluster first (else use current context)
PROVISION_ARGS=()   # provisioner-specific flags (--project-id/--region/--cluster/--yes)
SKIP_FLEET="0"

err() { echo -e "\033[0;31m[single-tenant]\033[0m $1" >&2; }
log() { echo -e "\033[0;32m[single-tenant]\033[0m $1"; }

# Parse only the profile-specific flags; everything else is forwarded verbatim to BOTH
# passes (so every k8s-deploy.sh flag — cert-manager, dns01, etc. — works here unchanged).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org-name)          ORG_NAME="$2"; shift 2 ;;
    --org-display-name)  ORG_DISPLAY_NAME="$2"; shift 2 ;;
    --org-owner-email)   ORG_OWNER_EMAIL="$2"; shift 2 ;;
    --org-tier)          ORG_TIER="$2"; shift 2 ;;
    --base-domain)       BASE_DOMAIN="$2"; shift 2 ;;
    --provision)         PROVISION="$2"; shift 2 ;;
    --project-id|--region|--cluster) PROVISION_ARGS+=("$1" "$2"); shift 2 ;;
    --yes)               PROVISION_ARGS+=("$1"); shift ;;
    --skip-fleet)        SKIP_FLEET="1"; shift ;;
    -h|--help)           grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                   PASSTHROUGH+=("$1"); shift ;;
  esac
done

[[ -n "$BASE_DOMAIN" ]]     || { err "--base-domain is required (the org is served at <org-name>.<base-domain>)."; exit 1; }
[[ -n "$ORG_NAME" ]]        || { err "--org-name is required (the seeded organisation name)."; exit 1; }
[[ -n "$ORG_OWNER_EMAIL" ]] || { err "--org-owner-email is required (the org's single owner)."; exit 1; }

if [[ "$SKIP_FLEET" != "1" ]]; then
  if [[ -z "$FLEET_CHART" || ! -d "$FLEET_CHART" ]]; then
    echo -e "\033[0;31m[single-tenant]\033[0m The fleet-platform chart moved to the WeOwnAI repo (elewa-git/opencrane#150) and no longer ships in opencrane." >&2
    echo -e "\033[0;31m[single-tenant]\033[0m Set FLEET_CHART_DIR to a checked-out copy of WeOwnAI's apps/fleet-platform and re-run, or use --skip-fleet." >&2
    exit 1
  fi
fi

# Optionally provision a cluster first (--provision local|gke|vps), then run BOTH passes onto it.
# Without --provision, deploy onto the current kubectl context. PROVISION_DEPLOY_SET (e.g. k3s's
# traefik) rides on PASSTHROUGH so it reaches both the fleet and silo passes.
if [[ -n "$PROVISION" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/provision.sh"
  _provision_cluster "$PROVISION" ${PROVISION_ARGS[@]+"${PROVISION_ARGS[@]}"}
  [[ ${#PROVISION_DEPLOY_SET[@]} -gt 0 ]] && PASSTHROUGH+=("${PROVISION_DEPLOY_SET[@]}")
fi

# --- Pass 1: the FLEET chart — bootstrap + fleet-manager, self-service OFF, ONE org seeded. ---
if [[ "$SKIP_FLEET" != "1" ]]; then
  log "Pass 1/2: fleet chart (cluster bootstrap + fleet-manager; self-service OFF; seeding org '$ORG_NAME')"
  FLEET_SET=(
    --base-domain "$BASE_DOMAIN"
    --set "fleetManager.clusterTenantApi.enabled=false"
    --set "billing.enabled=false"
    --set "multiInstance.enabled=false"
    --set "clusterTenant.seed.name=$ORG_NAME"
    --set "clusterTenant.seed.ownerEmail=$ORG_OWNER_EMAIL"
    --set "clusterTenant.seed.tier=$ORG_TIER"
  )
  [[ -n "$ORG_DISPLAY_NAME" ]] && FLEET_SET+=(--set "clusterTenant.seed.displayName=$ORG_DISPLAY_NAME")
  OPENCRANE_CHART_DIR="$FLEET_CHART" "$CORE" "${FLEET_SET[@]}" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
else
  log "Pass 1/2: fleet chart skipped (--skip-fleet)"
fi

# --- Pass 2: the SILO chart for that one org (its opencrane-ui + planes in opencrane-<org>). ---
# The fleet operator (pass 1) binds opencrane-<org>; the silo install converges into it (the
# operator's namespace apply is idempotent, so either ordering of the namespace settles).
log "Pass 2/2: silo chart for org '$ORG_NAME' (opencrane-ui + planes in opencrane-$ORG_NAME)"
exec "$SILO_DEPLOY" --base-domain "$BASE_DOMAIN" --cluster-tenant "$ORG_NAME" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
