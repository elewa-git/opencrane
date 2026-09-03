#!/usr/bin/env bash

# Supplies an independently provisioned payload keyring and its data digest to the server chart.
build_conversation_payload_keyring_helm_args()
{
  local namespace="$1"
  local secret_name="${CONVERSATION_PAYLOAD_KEYRING_SECRET:-opencrane-conversation-payload}"
  local checksum=""

  if ! kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.keyring\.json}' | base64 -d 2>/dev/null | _validate_conversation_payload_keyring; then
    echo "[conversation-payload] Secret '$secret_name' has an invalid keyring. Refusing to render a server with unreadable payload encryption." >&2
    return 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.keyring\.json}' | sha256sum | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    checksum="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.keyring\.json}' | shasum -a 256 | awk '{print $1}')"
  else
    echo "[conversation-payload] sha256sum or shasum is required to create the payload-keyring rollout trigger." >&2
    return 1
  fi
  if [[ -z "$checksum" ]]; then
    echo "[conversation-payload] Secret '$secret_name' could not be hashed. Refusing to render a server without a payload-keyring rollout trigger." >&2
    return 1
  fi
  CONVERSATION_PAYLOAD_KEYRING_HELM_ARGS=(
    --set-string "clustertenantManager.conversationPayloadKeyring.existingSecret=$secret_name"
    --set-string "clustertenantManager.conversationPayloadKeyring.secretKey=keyring.json"
    --set-string "clustertenantManager.conversationPayloadKeyring.checksum=$checksum"
  )
}

# Validates the active and retained keys without printing their identifiers or key material.
_validate_conversation_payload_keyring()
{
  node -e '
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => value += chunk);
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(value);
        const id = parsed.activeKeyId;
        const keys = parsed.keys;
        if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) || !keys || typeof keys !== "object" || Array.isArray(keys) || !Object.hasOwn(keys, id))
          process.exit(1);
        for (const encoded of Object.values(keys)) {
          const key = typeof encoded === "string" ? Buffer.from(encoded, "base64") : null;
          if (!key || key.length !== 32 || key.toString("base64") !== encoded)
            process.exit(1);
        }
      } catch {
        process.exit(1);
      }
    });'
}

# Creates a keyring when it is missing and refuses to replace an existing keyring that fails validation.
ensure_conversation_payload_keyring_secret()
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
    echo "[conversation-payload] Existing Secret '$secret_name' could not be read. Refusing to replace it." >&2
    return 1
  fi
  if [[ -n "$existing_name" ]]; then
    if ! encoded_keyring="$(kubectl get secret "$secret_name" -n "$namespace" -o jsonpath='{.data.keyring\.json}')" ||
      [[ -z "$encoded_keyring" ]] ||
      ! printf '%s' "$encoded_keyring" | base64 -d 2>/dev/null | _validate_conversation_payload_keyring; then
      echo "[conversation-payload] Existing Secret '$secret_name' has an invalid keyring. Repair it deliberately before retrying." >&2
      return 1
    fi
    echo "[conversation-payload] Retaining existing Secret '$secret_name'."
    return 0
  fi

  key_id="key-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
  encoded_key="$(openssl rand -base64 32 | tr -d '\n')"
  keyring="$(printf '{\"activeKeyId\":\"%s\",\"keys\":{\"%s\":\"%s\"}}' "$key_id" "$key_id" "$encoded_key")"
  echo "[conversation-payload] Creating Secret '$secret_name'."
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
