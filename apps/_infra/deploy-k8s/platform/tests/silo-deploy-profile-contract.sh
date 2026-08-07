#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh"
MODEL_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/initial-model-provider.sh"

grep -Fq -- '--acme-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--initial-model-provider' "$DEPLOY_SCRIPT"
grep -Fq -- 'OPENCRANE_INITIAL_MODEL_API_KEY' "$DEPLOY_SCRIPT"
grep -Fq -- 'validate_initial_model_provider' "$MODEL_HELPER"
grep -Fq -- 'publish_initial_model_provider_secret' "$MODEL_HELPER"
grep -Fq -- 'build_initial_model_provider_helm_args' "$MODEL_HELPER"
grep -Fq -- '--from-file=apiKey=<(printf' "$MODEL_HELPER"
if grep -Fq -- '--from-literal=apiKey="$api_key"' "$MODEL_HELPER"; then
  echo "initial model provider key is exposed through kubectl command arguments" >&2
  exit 1
fi
grep -Fq -- 'ACME_EMAIL="${OPENCRANE_ACME_EMAIL:-}"' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_ISSUER_URL="$2"; PASSTHROUGH+=(--oidc-issuer-url "$2")' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_CLIENT_ID="$2"; PASSTHROUGH+=(--oidc-client-id "$2")' "$DEPLOY_SCRIPT"
grep -Fq -- '--acme-email is required to issue a browser-trusted certificate' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.mode=acme"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.issuerName=opencrane-acme-issuer"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.acme.email=${ACME_EMAIL}"' "$DEPLOY_SCRIPT"

provider_secret_calls=()
kubectl()
{
  provider_secret_calls+=("$*")
  if [[ "$1 $2" == "get secret" ]]; then
    return 0
  fi
  return 0
}
source "$MODEL_HELPER"
ensure_provider_key_secrets "opencrane-testv2"
if printf '%s\n' "${provider_secret_calls[@]}" | grep -Fq 'create secret'; then
  echo "provider placeholder creation overwrites an existing BYOK Secret" >&2
  exit 1
fi

echo "silo deploy profile contract: PASS"
