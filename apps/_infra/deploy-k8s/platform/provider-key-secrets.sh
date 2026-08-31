#!/usr/bin/env bash
# Provider-custody placeholder creation. The server may update only this fixed Secret catalogue;
# the deployer creates missing objects without replacing keys admitted by earlier durable commands.

ensure_provider_key_secrets()
{
  local namespace="$1"
  local provider
  for provider in openai anthropic gemini mistral deepseek glm; do
    if kubectl get secret "byok-provider-key-${provider}" -n "$namespace" >/dev/null 2>&1; then
      continue
    fi
    kubectl create secret generic "byok-provider-key-${provider}" -n "$namespace" --from-literal=apiKey=
  done
}
