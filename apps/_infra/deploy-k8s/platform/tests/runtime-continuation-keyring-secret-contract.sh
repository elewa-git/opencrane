#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MOCK_KUBECTL_LOG="$(mktemp)"
MOCK_SECRET_STATE="absent"
MOCK_CREATE_FAILURE="false"

trap 'rm -f "$MOCK_KUBECTL_LOG"' EXIT

source "$PLATFORM_DIR/runtime-continuation-keyring-secret.sh"

kubectl()
{
  if [[ "$1" == "get" && "$*" == *"{.metadata.name}"* ]]; then
    [[ "$MOCK_SECRET_STATE" == "absent" ]] || printf '%s' "opencrane-runtime-continuation"
    return 0
  fi

  if [[ "$1" == "get" && "$*" == *"data.keyring"* ]]; then
    case "$MOCK_SECRET_STATE" in
      valid)
        printf '%s' '{"activeKeyId":"key-current","keys":{"key-current":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}}' | base64
        ;;
      malformed) printf '%s' 'bm90LWpzb24=' ;;
      missing|empty) return 0 ;;
      *) return 1 ;;
    esac
    return 0
  fi

  if [[ "$1" == "create" ]]; then
	local argument=""
	local keyring_file=""
	local keyring_mode=""
	for argument in "$@"; do
	  [[ "$argument" != --from-literal=* ]] || return 1
	  if [[ "$argument" == --from-file=keyring.json=* ]]; then
	    keyring_file="${argument#--from-file=keyring.json=}"
	  fi
	done
	[[ -n "$keyring_file" && -f "$keyring_file" ]]
	keyring_mode="$(stat -f '%Lp' "$keyring_file" 2>/dev/null || stat -c '%a' "$keyring_file")"
	[[ "$keyring_mode" == "600" ]]
	_validate_runtime_continuation_keyring < "$keyring_file"
    printf '%s\n' "create" >> "$MOCK_KUBECTL_LOG"
	printf '%s\n' "keyring-file:$keyring_file" >> "$MOCK_KUBECTL_LOG"
	[[ "$MOCK_CREATE_FAILURE" != "true" ]] || return 1
    printf '%s\n' "apiVersion: v1"
    return 0
  fi
  if [[ "$1" == "apply" ]]; then
	while IFS= read -r _line; do :; done
    printf '%s\n' "apply" >> "$MOCK_KUBECTL_LOG"
    return 0
  fi
  return 1
}

assert_created_only_when_absent()
{
  MOCK_SECRET_STATE="absent"
  : > "$MOCK_KUBECTL_LOG"
  ensure_runtime_continuation_keyring_secret "test" "opencrane-runtime-continuation"
  grep -qx "create" "$MOCK_KUBECTL_LOG"
  grep -qx "apply" "$MOCK_KUBECTL_LOG"
	local keyring_file
	keyring_file="$(sed -n 's/^keyring-file://p' "$MOCK_KUBECTL_LOG")"
	[[ -n "$keyring_file" && ! -e "$keyring_file" ]]
}

assert_removed_when_creation_fails()
{
  MOCK_SECRET_STATE="absent"
  MOCK_CREATE_FAILURE="true"
  : > "$MOCK_KUBECTL_LOG"
  if ensure_runtime_continuation_keyring_secret "test" "opencrane-runtime-continuation"; then
    echo "expected failed Secret creation to fail closed" >&2
    return 1
  fi
  local keyring_file
  keyring_file="$(sed -n 's/^keyring-file://p' "$MOCK_KUBECTL_LOG")"
  [[ -n "$keyring_file" && ! -e "$keyring_file" ]]
  MOCK_CREATE_FAILURE="false"
}

assert_retained_when_valid()
{
  MOCK_SECRET_STATE="valid"
  : > "$MOCK_KUBECTL_LOG"
  ensure_runtime_continuation_keyring_secret "test" "opencrane-runtime-continuation"
  [[ ! -s "$MOCK_KUBECTL_LOG" ]]
}

assert_rejected_without_replacement()
{
  MOCK_SECRET_STATE="$1"
  : > "$MOCK_KUBECTL_LOG"
  if ensure_runtime_continuation_keyring_secret "test" "opencrane-runtime-continuation"; then
    echo "expected existing $1 Secret to fail closed" >&2
    return 1
  fi
  [[ ! -s "$MOCK_KUBECTL_LOG" ]]
}

assert_helm_args()
{
  RUNTIME_CONTINUATION_KEYRING_SECRET=custom-runtime-continuation
  build_runtime_continuation_keyring_helm_args
  [[ " ${RUNTIME_CONTINUATION_KEYRING_HELM_ARGS[*]} " == *" clustertenantManager.workflows.continuationKeyring.existingSecret=custom-runtime-continuation "* ]]
  [[ " ${RUNTIME_CONTINUATION_KEYRING_HELM_ARGS[*]} " == *" clustertenantManager.workflows.continuationKeyring.secretKey=keyring.json "* ]]
}

assert_created_only_when_absent
assert_removed_when_creation_fails
assert_retained_when_valid
assert_rejected_without_replacement "missing"
assert_rejected_without_replacement "empty"
assert_rejected_without_replacement "malformed"
assert_helm_args

echo "runtime continuation keyring Secret contract passed"
