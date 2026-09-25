#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: ensure-mcp-material-keyring.sh <server-namespace> <secret-name>" >&2
  exit 2
fi

mcp_server_namespace="$1"
mcp_keyring_secret="$2"
# A failed read is not proof of absence. Leave existing or uncertain keyrings untouched.
mcp_existing_keyring="$(kubectl get secret "$mcp_keyring_secret" -n "$mcp_server_namespace" --ignore-not-found -o name)"
if [[ -n "$mcp_existing_keyring" ]]; then
  exit 0
fi

umask 077
mcp_keyring_directory="$(mktemp -d)"
trap 'rm -f "$mcp_keyring_directory/keyring.json"; rmdir "$mcp_keyring_directory"' EXIT
mcp_material_key="$(openssl rand -base64 32)"
printf '{"currentKeyId":"key-1","keys":[{"id":"key-1","secretBase64":"%s"}]}\n' "$mcp_material_key" > "$mcp_keyring_directory/keyring.json"
unset mcp_material_key
# Create once; losing this key would prevent a saved connection command from proving its replay.
kubectl create secret generic "$mcp_keyring_secret" -n "$mcp_server_namespace" --from-file="keyring.json=$mcp_keyring_directory/keyring.json"
