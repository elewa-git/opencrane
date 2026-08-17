#!/usr/bin/env bash

# Preserves the standalone invitation-link signing key so upgrades do not invalidate outstanding links.
ensure_invitation_signing_secret()
{
  local namespace="$1"
  local secret_name="$2"
  local existing_name=""
  local encoded_key=""
  local existing_key=""
  local generated_key=""

  if ! existing_name="$(kubectl get secret "$secret_name" -n "$namespace" --ignore-not-found -o jsonpath='{.metadata.name}')"; then
    echo "[invitation-signing] Existing Secret '$secret_name' could not be read. Refusing to replace it." >&2
    return 1
  fi
  if [[ -n "$existing_name" ]]; then
    if ! encoded_key="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.key}')" ||
      [[ -z "$encoded_key" ]] ||
      ! existing_key="$(printf '%s' "$encoded_key" | base64 -d 2>/dev/null)" ||
      [[ ! "$existing_key" =~ ^[A-Za-z0-9_-]{43,}$ ]]; then
      echo "[invitation-signing] Existing Secret '$secret_name' has an invalid key. Replace it deliberately before retrying." >&2
      return 1
    fi
    echo "[invitation-signing] Retaining existing Secret '$secret_name'."
    return 0
  fi

  generated_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  echo "[invitation-signing] Creating Secret '$secret_name'."
  kubectl create secret generic "$secret_name" -n "$namespace" \
    --from-literal=key="$generated_key" \
    --dry-run=client -o yaml | kubectl apply -f -
}
