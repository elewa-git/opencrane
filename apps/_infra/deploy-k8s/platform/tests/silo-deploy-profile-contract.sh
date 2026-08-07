#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh"
MODEL_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/initial-model-provider.sh"

grep -Fq -- '--acme-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--first-user-email' "$DEPLOY_SCRIPT"
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
grep -Fq -- '--first-user-email is required to claim this standalone silo' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.mode=acme"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.issuerName=opencrane-acme-issuer"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.acme.email=${ACME_EMAIL}"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set-string "clustertenantManager.firstUser.clusterTenant=${CLUSTER_TENANT}"' "$DEPLOY_SCRIPT"
DEPLOY_CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
grep -Fq -- "Retaining existing OIDC secret '\$OIDC_SECRET_NAME'" "$DEPLOY_CORE"
grep -Fq -- "no complete '\$OIDC_SECRET_NAME' exists" "$DEPLOY_CORE"
grep -Fq -- "jsonpath='{.data.OIDC_CLIENT_SECRET}'" "$DEPLOY_CORE"
grep -Fq -- "jsonpath='{.data.OIDC_SESSION_SECRET}'" "$DEPLOY_CORE"
grep -Fq -- '--set "litellm.storeModelInDb=true"' "$DEPLOY_CORE"
grep -Fq -- '--set-string "litellm.existingSaltSecret=opencrane-litellm"' "$DEPLOY_CORE"
grep -Fq -- '--set-string "litellm.saltSecretKey=LITELLM_SALT_KEY"' "$DEPLOY_CORE"
grep -Fq -- '--first-user-email)             FIRST_USER_EMAIL="$2"' "$DEPLOY_CORE"
grep -Fq -- '--set-string)    EXTRA_SET+=(--set-string "$2")' "$DEPLOY_CORE"
grep -Fq -- '--set-string "clustertenantManager.firstUser.email=$FIRST_USER_EMAIL"' "$DEPLOY_CORE"
grep -Fq -- '_guard_standalone_first_user_issuer' "$DEPLOY_CORE"
grep -Fq -- 'Standalone first-owner issuer is immutable after deployment' "$DEPLOY_CORE"
grep -Fq -- 'prior_first_user_email' "$DEPLOY_CORE"
grep -Fq -- 'omitting --first-user-email' "$DEPLOY_CORE"
grep -Fq -- 'requires --oidc-issuer-url on every upgrade' "$DEPLOY_CORE"
grep -Fq -- 'Do not use --values or --reset-values' "$DEPLOY_CORE"
grep -Fq -- 'Do not override clustertenantManager.firstUser through --helm-arg' "$DEPLOY_CORE"
grep -Fq -- '"${EXTRA_HELM_ARGS[@]-}"' "$DEPLOY_CORE"

# Strict mode must not abort the immutable issuer guard when the normal
# deployment path provides no raw Helm arguments. Bash may expand this as zero
# entries or one empty entry, neither of which is a supplied Helm argument.
empty_helm_args=()
for _empty_helm_arg in "${empty_helm_args[@]-}"; do
  if [[ -n "$_empty_helm_arg" ]]; then
    echo "empty raw Helm arguments must not yield a supplied Helm argument" >&2
    exit 1
  fi
done

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
