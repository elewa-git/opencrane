#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/initial-model-provider.sh"

helm_args=(upgrade)
append_initial_model_provider_helm_args ""
[[ "${#helm_args[@]}" -eq 1 ]]
[[ "${helm_args[0]}" == "upgrade" ]]

append_initial_model_provider_helm_args openai
[[ "${#helm_args[@]}" -eq 5 ]]
[[ " ${helm_args[*]} " == *" clustertenantManager.initialModel.provider=openai "* ]]
[[ " ${helm_args[*]} " == *" clustertenantManager.initialModel.existingSecret=byok-provider-key-openai "* ]]

echo "initial model provider Helm arguments contract: PASS"
