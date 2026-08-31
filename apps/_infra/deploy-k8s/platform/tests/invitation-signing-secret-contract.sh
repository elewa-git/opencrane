#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MOCK_KUBECTL_LOG="$(mktemp)"
MOCK_SECRET_STATE="absent"

trap 'rm -f "$MOCK_KUBECTL_LOG"' EXIT

source "$PLATFORM_DIR/invitation-signing-secret.sh"

kubectl()
{
  if [[ "$1" == "get" && "$*" == *"{.metadata.name}"* ]]; then
    if [[ "$MOCK_SECRET_STATE" != "absent" ]]; then
      printf '%s' "opencrane-invitation-signing"
    fi
    return 0
  fi

  if [[ "$1" == "get" && "$*" == *"{.data.key}"* ]]; then
    case "$MOCK_SECRET_STATE" in
      valid) printf '%s' "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==" ;;
      malformed) printf '%s' "c2hvcnQ=" ;;
      missing|empty) return 0 ;;
      *) return 1 ;;
    esac
    return 0
  fi

  if [[ "$1" == "create" ]]; then
    printf '%s\n' "create" >> "$MOCK_KUBECTL_LOG"
    printf '%s\n' "apiVersion: v1"
    return 0
  fi

  if [[ "$1" == "apply" ]]; then
    printf '%s\n' "apply" >> "$MOCK_KUBECTL_LOG"
    return 0
  fi

  return 1
}

openssl()
{
  if [[ "$1" == "genpkey" ]]; then
    printf '%s\n' '-----BEGIN PRIVATE KEY-----' > "$5"
    return 0
  fi
  printf '%s\n' "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
}

assert_created_only_when_absent()
{
  MOCK_SECRET_STATE="absent"
  : > "$MOCK_KUBECTL_LOG"
  ensure_invitation_signing_secret "test" "opencrane-invitation-signing"
  grep -qx "create" "$MOCK_KUBECTL_LOG"
  grep -qx "apply" "$MOCK_KUBECTL_LOG"
}

assert_retained_when_valid()
{
  MOCK_SECRET_STATE="valid"
  : > "$MOCK_KUBECTL_LOG"
  ensure_invitation_signing_secret "test" "opencrane-invitation-signing"
  [[ ! -s "$MOCK_KUBECTL_LOG" ]]
}

assert_rejected_without_replacement()
{
  local state="$1"
  MOCK_SECRET_STATE="$state"
  : > "$MOCK_KUBECTL_LOG"
  if ensure_invitation_signing_secret "test" "opencrane-invitation-signing"; then
    echo "expected existing $state Secret to fail closed" >&2
    return 1
  fi
  [[ ! -s "$MOCK_KUBECTL_LOG" ]]
}

assert_standalone_membership_key_created_only_when_absent()
{
  MOCK_SECRET_STATE="absent"
  : > "$MOCK_KUBECTL_LOG"
  ensure_standalone_membership_signing_secret "test" "opencrane-standalone-membership-signing"
  grep -qx "create" "$MOCK_KUBECTL_LOG"
  grep -qx "apply" "$MOCK_KUBECTL_LOG"
}

assert_membership_helm_args()
{
  MEMBERSHIP_MODE=standalone
  INVITATION_SIGNING_SECRET=custom-invitation-signing
  build_membership_helm_args
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.mode=standalone "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.invitationSigningExistingSecret=custom-invitation-signing "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.invitationSigningKeyKey=key "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.membershipSigningExistingSecret=opencrane-standalone-membership-signing "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.membershipSigningKeyKey=private-key.pem "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.issuerId=opencrane-standalone-opencrane "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.standalone.issuerKeyId=local-ed25519-1 "* ]]
  MEMBERSHIP_MODE=fleet
  build_membership_helm_args
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " == *" clustertenantManager.membership.mode=fleet "* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " != *" invitationSigningExistingSecret="* ]]
  [[ " ${MEMBERSHIP_HELM_ARGS[*]} " != *" membershipSigningExistingSecret="* ]]
}

assert_created_only_when_absent
assert_retained_when_valid
assert_rejected_without_replacement "missing"
assert_rejected_without_replacement "empty"
assert_rejected_without_replacement "malformed"
assert_standalone_membership_key_created_only_when_absent
assert_membership_helm_args

echo "invitation signing Secret contract passed"
