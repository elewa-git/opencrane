#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
PROFILE_DIR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/values/prerequisites/gke-autopilot-dev"
OUTPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-prerequisites-render.XXXXXX")"
trap 'rm -rf -- "$OUTPUT_DIR"' EXIT
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/prerequisite-chart-lock.sh"

command -v helm >/dev/null 2>&1 || { echo 'helm is required' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'node is required' >&2; exit 1; }

pull_and_verify()
{
  local chart="$1" repository="$2" version="$3" expected_sha256="$4"
  local archive="$OUTPUT_DIR/${chart}-${version}.tgz"
  helm pull "$chart" \
    --repo "$repository" \
    --version "$version" \
    --destination "$OUTPUT_DIR"
  node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const [path, expected] = process.argv.slice(1);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
    if (actual !== expected) throw new Error(`${path} has SHA-256 ${actual}, expected ${expected}`);
  ' "$archive" "$expected_sha256"
  printf '%s' "$archive"
}

INGRESS_ARCHIVE="$(pull_and_verify "$INGRESS_CHART" "$INGRESS_REPOSITORY" "$INGRESS_VERSION" "$INGRESS_ARCHIVE_SHA256")"
CERT_MANAGER_ARCHIVE="$(pull_and_verify "$CERT_MANAGER_CHART" "$CERT_MANAGER_REPOSITORY" "$CERT_MANAGER_VERSION" "$CERT_MANAGER_ARCHIVE_SHA256")"
CNPG_ARCHIVE="$(pull_and_verify "$CNPG_CHART" "$CNPG_REPOSITORY" "$CNPG_VERSION" "$CNPG_ARCHIVE_SHA256")"

helm template "$INGRESS_RELEASE" "$INGRESS_ARCHIVE" \
  --namespace "$INGRESS_NAMESPACE" \
  --include-crds \
  --values "$PROFILE_DIR/ingress-nginx.yaml" \
  --set-string controller.service.loadBalancerIP=35.205.225.244 \
  >"$OUTPUT_DIR/ingress-nginx.yaml"

helm template "$CERT_MANAGER_RELEASE" "$CERT_MANAGER_ARCHIVE" \
  --namespace "$CERT_MANAGER_NAMESPACE" \
  --include-crds \
  --values "$PROFILE_DIR/cert-manager.yaml" \
  >"$OUTPUT_DIR/cert-manager.yaml"

helm template "$CNPG_RELEASE" "$CNPG_ARCHIVE" \
  --namespace "$CNPG_NAMESPACE" \
  --include-crds \
  --values "$PROFILE_DIR/cloudnative-pg.yaml" \
  >"$OUTPUT_DIR/cloudnative-pg.yaml"

export OPENCRANE_EXPECTED_INGRESS_CLUSTER_RESOURCES
export OPENCRANE_EXPECTED_CERT_MANAGER_CLUSTER_RESOURCES
export OPENCRANE_EXPECTED_CNPG_CLUSTER_RESOURCES
OPENCRANE_EXPECTED_INGRESS_CLUSTER_RESOURCES="$(printf '%s\n' "${INGRESS_CLUSTER_RESOURCES[@]}")"
OPENCRANE_EXPECTED_CERT_MANAGER_CLUSTER_RESOURCES="$(printf '%s\n' "${CERT_MANAGER_CLUSTER_RESOURCES[@]}")"
OPENCRANE_EXPECTED_CNPG_CLUSTER_RESOURCES="$(printf '%s\n' "${CNPG_CLUSTER_RESOURCES[@]}")"

node "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/prerequisites-render-assertions.mjs" \
  "$OUTPUT_DIR/ingress-nginx.yaml" \
  "$OUTPUT_DIR/cert-manager.yaml" \
  "$OUTPUT_DIR/cloudnative-pg.yaml"

echo "bootstrap prerequisites render contract: PASS"
