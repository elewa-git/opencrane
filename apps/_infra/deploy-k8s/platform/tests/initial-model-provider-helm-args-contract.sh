#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/initial-model-provider.sh"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"

helm_args=(upgrade)
append_initial_model_provider_helm_args "" ""
[[ "${#helm_args[@]}" -eq 1 ]]
[[ "${helm_args[0]}" == "upgrade" ]]

append_initial_model_provider_helm_args openai openai/gpt-5.4-nano
[[ "${#helm_args[@]}" -eq 7 ]]
[[ " ${helm_args[*]} " == *" clustertenantManager.initialModel.provider=openai "* ]]
[[ " ${helm_args[*]} " == *" clustertenantManager.initialModel.model=openai/gpt-5.4-nano "* ]]
[[ " ${helm_args[*]} " == *" clustertenantManager.initialModel.existingSecret=byok-provider-key-openai "* ]]

validate_initial_model_provider "" "" ""
validate_initial_model_provider openai openai/gpt-5.4-nano provider-key
if validate_initial_model_provider openai "" provider-key >/dev/null 2>&1; then
  echo "initial provider accepted an incomplete model tuple" >&2
  exit 1
fi
if validate_initial_model_provider openai anthropic/claude provider-key >/dev/null 2>&1; then
  echo "initial provider accepted another provider's model" >&2
  exit 1
fi

grep -Fq 'unset OPENCRANE_INITIAL_MODEL_API_KEY' "$DEPLOY_SCRIPT"
grep -Fq 'INITIAL_MODEL_API_KEY=""' "$DEPLOY_SCRIPT"

echo "initial model provider Helm arguments contract: PASS"
