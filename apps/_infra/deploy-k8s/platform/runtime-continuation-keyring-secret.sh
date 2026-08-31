#!/usr/bin/env bash

# Supplies the same continuation keyring Secret name to provisioning and the Helm release.
build_runtime_continuation_keyring_helm_args()
{
  local secret_name="${RUNTIME_CONTINUATION_KEYRING_SECRET:-opencrane-runtime-continuation}"
  RUNTIME_CONTINUATION_KEYRING_HELM_ARGS=(
    --set-string "clustertenantManager.workflows.continuationKeyring.existingSecret=$secret_name"
    --set-string "clustertenantManager.workflows.continuationKeyring.secretKey=keyring.json"
  )
}

# Validates a keyring without printing its identifiers or key material.
_validate_runtime_continuation_keyring()
{
  node -e '
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => value += chunk);
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(value);
        const id = parsed.activeKeyId;
        const encoded = parsed.keys && parsed.keys[id];
        const key = typeof encoded === "string" ? Buffer.from(encoded, "base64") : null;
        if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) || !key || key.length !== 32)
          process.exit(1);
      } catch {
        process.exit(1);
      }
    });'
}

# Preserves old keys because saved continuations name the key that encrypted them.
ensure_runtime_continuation_keyring_secret()
{
  local namespace="$1"
  local secret_name="$2"
  local existing_name=""
  local encoded_keyring=""
  local key_id=""
  local encoded_key=""
  local keyring=""
  local keyring_file=""
  local create_status=0

  if ! existing_name="$(kubectl get secret "$secret_name" -n "$namespace" --ignore-not-found -o jsonpath='{.metadata.name}')"; then
    echo "[runtime-continuation] Existing Secret '$secret_name' could not be read. Refusing to replace it." >&2
    return 1
  fi
  if [[ -n "$existing_name" ]]; then
    if ! encoded_keyring="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.keyring\.json}')" ||
      [[ -z "$encoded_keyring" ]] ||
      ! printf '%s' "$encoded_keyring" | base64 -d 2>/dev/null | _validate_runtime_continuation_keyring; then
      echo "[runtime-continuation] Existing Secret '$secret_name' has an invalid keyring. Repair it deliberately before retrying." >&2
      return 1
    fi
    echo "[runtime-continuation] Retaining existing Secret '$secret_name'."
    return 0
  fi

  key_id="key-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
  encoded_key="$(openssl rand -base64 32 | tr -d '\n')"
  keyring="$(printf '{"activeKeyId":"%s","keys":{"%s":"%s"}}' "$key_id" "$key_id" "$encoded_key")"
  echo "[runtime-continuation] Creating Secret '$secret_name'."
  if ! (
    keyring_file="$(mktemp)"
    trap 'rm -f "$keyring_file"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    chmod 0600 "$keyring_file"
    printf '%s' "$keyring" > "$keyring_file"
    kubectl create secret generic "$secret_name" -n "$namespace" \
      --from-file=keyring.json="$keyring_file" \
      --dry-run=client -o yaml | kubectl apply -f -
  ); then
    create_status=1
  fi
  keyring=""
  encoded_key=""
  return "$create_status"
}
