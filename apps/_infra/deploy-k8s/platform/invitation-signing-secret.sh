#!/usr/bin/env bash

# Reuses the same membership values for PostgreSQL and the final Helm install.
build_membership_helm_args()
{
  local membership_mode="${MEMBERSHIP_MODE:-standalone}"
  local invitation_signing_secret="${INVITATION_SIGNING_SECRET:-opencrane-invitation-signing}"
  local standalone_membership_signing_secret="${STANDALONE_MEMBERSHIP_SIGNING_SECRET:-opencrane-standalone-membership-signing}"
  local standalone_membership_issuer_id="${STANDALONE_MEMBERSHIP_ISSUER_ID:-opencrane-standalone-${RELEASE:-opencrane}}"
  local standalone_membership_key_id="${STANDALONE_MEMBERSHIP_KEY_ID:-local-ed25519-1}"
  MEMBERSHIP_HELM_ARGS=(--set-string "clustertenantManager.membership.mode=$membership_mode")
  if [[ "$membership_mode" == "standalone" ]]; then
    MEMBERSHIP_HELM_ARGS+=(
      --set-string "clustertenantManager.membership.standalone.invitationSigningExistingSecret=$invitation_signing_secret"
      --set-string "clustertenantManager.membership.standalone.invitationSigningKeyKey=key"
      --set-string "clustertenantManager.membership.standalone.membershipSigningExistingSecret=$standalone_membership_signing_secret"
      --set-string "clustertenantManager.membership.standalone.membershipSigningKeyKey=private-key.pem"
      --set-string "clustertenantManager.membership.standalone.issuerId=$standalone_membership_issuer_id"
      --set-string "clustertenantManager.membership.standalone.issuerKeyId=$standalone_membership_key_id"
    )
  fi
}

# Preserves the dedicated Ed25519 signing key used only for standalone membership snapshots.
ensure_standalone_membership_signing_secret()
{
  local namespace="$1"
  local secret_name="$2"
  local existing_name=""
  local encoded_key=""
  local existing_key=""
  local key_file=""

  if ! existing_name="$(kubectl get secret "$secret_name" -n "$namespace" --ignore-not-found -o jsonpath='{.metadata.name}')"; then
    echo "[standalone-membership] Existing Secret '$secret_name' could not be read. Refusing to replace it." >&2
    return 1
  fi
  if [[ -n "$existing_name" ]]; then
    if ! encoded_key="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.private-key\.pem}')" ||
      [[ -z "$encoded_key" ]] ||
      ! existing_key="$(printf '%s' "$encoded_key" | base64 -d 2>/dev/null)" ||
      ! printf '%s' "$existing_key" | openssl pkey -noout -text 2>/dev/null | grep -q 'ED25519 Private-Key'; then
      echo "[standalone-membership] Existing Secret '$secret_name' must contain an Ed25519 private-key.pem. Replace it deliberately before retrying." >&2
      return 1
    fi
    echo "[standalone-membership] Retaining existing Secret '$secret_name'."
    return 0
  fi

  key_file="$(mktemp)"
  if ! openssl genpkey -algorithm ED25519 -out "$key_file"; then
    rm -f "$key_file"
    return 1
  fi
  echo "[standalone-membership] Creating Secret '$secret_name'."
  if ! kubectl create secret generic "$secret_name" -n "$namespace" \
    --from-file=private-key.pem="$key_file" \
    --dry-run=client -o yaml | kubectl apply -f -; then
    rm -f "$key_file"
    return 1
  fi
  rm -f "$key_file"
}

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
