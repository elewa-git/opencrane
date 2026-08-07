#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
PROVISIONER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/provision.sh"
CALLS="$(mktemp "${TMPDIR:-/tmp}/opencrane-provision-contract.XXXXXX")"
trap 'rm -f -- "$CALLS"' EXIT

gcloud()
{
  printf 'gcloud %s\n' "$*" >>"$CALLS"
  case "$*" in
    *"--format=value(location)"*) printf 'EUROPE-WEST1\n' ;;
  esac
}

terraform()
{
  printf 'terraform %s\n' "$*" >>"$CALLS"
}

kubectl()
{
  printf 'kubectl %s\n' "$*" >>"$CALLS"
}

BASE_DOMAIN=""
unset OPENCRANE_TERRAFORM_STATE_BUCKET
source "$PROVISIONER"
_provision_cluster gke \
  --project-id weownai-proto \
  --region europe-west1 \
  --cluster opencrane-dev \
  --yes

grep -Fq 'fmt -check -recursive' "$CALLS"
grep -Fq 'storage buckets update gs://weownai-proto-opencrane-dev-tfstate' "$CALLS"
grep -Fq 'apply -input=false -auto-approve' "$CALLS"
grep -Fq 'container clusters get-credentials opencrane-dev --region europe-west1 --project weownai-proto' "$CALLS"

echo "provision contract: PASS"
