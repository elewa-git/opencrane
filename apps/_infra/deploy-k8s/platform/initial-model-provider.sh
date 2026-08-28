#!/usr/bin/env bash
# Initial model-provider deployment support. This helper owns the shell-level custody boundary:
# validate an environment-only API key, publish it directly to its release-local Secret, and build
# the non-secret Helm settings that cause the server to register it with LiteLLM at startup.

validate_initial_model_provider()
{
  local provider="$1"
  local model="$2"
  local api_key="$3"
  if [[ -z "$provider" && -z "$model" && -z "$api_key" ]]; then
    return 0
  fi
  if [[ -z "$provider" || -z "$model" || -z "$api_key" ]]; then
    printf '%s\n' '--initial-model-provider, --initial-model, and OPENCRANE_INITIAL_MODEL_API_KEY must be configured together. The API key is environment-only to keep it out of command history and Helm values.' >&2
    return 1
  fi
  case "$provider" in
    openai|anthropic|gemini|mistral|deepseek|glm) ;;
    *) printf "Invalid --initial-model-provider '%s'. Supported providers: openai, anthropic, gemini, mistral, deepseek, glm.\n" "$provider" >&2; return 1 ;;
  esac
  if [[ ! "$model" =~ ^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:/-]*$ ]]; then
    printf "Invalid --initial-model '%s'. Use one reviewed provider-prefixed model name.\n" "$model" >&2
    return 1
  fi
  local model_provider="$provider"
  [[ "$provider" == "glm" ]] && model_provider="zai"
  if [[ "$model" != "$model_provider/"* ]]; then
    printf "Initial model '%s' does not belong to provider '%s'.\n" "$model" "$provider" >&2
    return 1
  fi
}

ensure_provider_key_secrets()
{
  local namespace="$1"
  local provider
  # Pre-creating the fixed catalogue removes the server's otherwise broad Secret-create permission.
  for provider in openai anthropic gemini mistral deepseek glm; do
    if kubectl get secret "byok-provider-key-${provider}" -n "$namespace" >/dev/null 2>&1; then
      continue
    fi
    # Create only a missing placeholder. Applying an empty value would silently erase a key that
    # a user provisioned through the BYOK API on an earlier release.
    kubectl create secret generic "byok-provider-key-${provider}" -n "$namespace" --from-literal=apiKey=
  done
}

publish_initial_model_provider_secret()
{
  local namespace="$1"
  local provider="$2"
  local api_key="$3"
  if [[ -z "$provider" ]]; then
    return 0
  fi
  # A literal-valued secret option would place the raw key in kubectl's argv, observable by local
  # process inspectors. A process-substitution descriptor preserves the exact bytes without a
  # shell-history entry, temporary file, or command-line secret.
  kubectl create secret generic "byok-provider-key-${provider}" -n "$namespace" \
    --from-file=apiKey=<(printf '%s' "$api_key") \
    --dry-run=client -o yaml | kubectl apply -f -
}

# Appends directly so an omitted provider never requires expanding an unset array under Bash 3.2 with `set -u`.
append_initial_model_provider_helm_args()
{
  local provider="$1"
  local model="$2"
  if [[ -z "$provider" ]]; then
    return 0
  fi
  helm_args+=(
    --set-string "clustertenantManager.initialModel.provider=$provider"
    --set-string "clustertenantManager.initialModel.model=$model"
    --set-string "clustertenantManager.initialModel.existingSecret=byok-provider-key-${provider}"
  )
}
