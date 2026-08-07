#!/usr/bin/env bash

# Reconciles the one namespace-local credential that lets a private first-party registry remain
# private. It never accepts credential bytes through Helm values or command arguments.
ensure_registry_pull_secret()
{
  local namespace="$1" secret_name="$2" config_file="$3"
  if [[ -n "$config_file" ]]; then
    [[ -n "$secret_name" ]] || { err "--registry-pull-config-file requires --registry-pull-secret."; exit 1; }
    [[ -f "$config_file" ]] || { err "Registry pull config '$config_file' is not a file."; exit 1; }
    jq -e '.auths["ghcr.io"].auth | strings | length > 0' "$config_file" >/dev/null || {
      err "Registry pull config '$config_file' must contain a GHCR auth entry."
      exit 1
    }
    kubectl create secret generic "$secret_name" -n "$namespace" \
      --type=kubernetes.io/dockerconfigjson \
      --from-file=.dockerconfigjson="$config_file" \
      --dry-run=client -o yaml | kubectl apply -f -
  elif [[ -n "$secret_name" ]]; then
    [[ "$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.type}' 2>/dev/null)" == "kubernetes.io/dockerconfigjson" ]] || {
      err "Registry pull Secret '$secret_name' must exist in '$namespace' with type kubernetes.io/dockerconfigjson."
      exit 1
    }
  fi
}
