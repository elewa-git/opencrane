#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
RETIREMENT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/retire-legacy-obot-mcp-server.sh"
DEPLOY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
CALLS="$TEST_DIR/calls"
FOUND_RESOURCES=""
MISMATCH_RESOURCE=""
MISMATCH_FIELD=""
INSPECTION_FAILURE_RESOURCE=""
RAW_DELETE_FAILURE_RESOURCE=""
REPLACEMENT_RESOURCE=""
UPDATED_RESOURCE=""
SERVER_IMAGE="ghcr.io/elewa-git/opencrane-server:sha-aaaaaaaa"
CONTROLLER_IMAGE="ghcr.io/elewa-git/opencrane-agent-controller@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
SCANNER_IMAGE="ghcr.io/elewa-git/opencrane-artifact-scanner@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
RUNTIME_IMAGE="ghcr.io/elewa-git/opencrane-agent-runtime@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

err()
{
  printf '%s\n' "$*" >&2
}

log()
{
  :
}

_assert_prefix_count()
{
  local expected="$1"
  local prefix="$2"
  awk -v expected="$expected" -v prefix="$prefix" '
    index($0, prefix) == 1 { count += 1 }
    END {
      if (count + 0 != expected) {
        printf "Expected %s call(s) prefixed by %s, found %s.\n", expected, prefix, count + 0 > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

_assert_identity_preconditioned_delete_count()
{
  local expected="$1"
  awk -v expected="$expected" '
    index($0, "delete-options ") == 1 &&
    index($0, "\"preconditions\":{\"uid\":\"uid-") > 0 &&
    index($0, "\",\"resourceVersion\":\"rv-1\"") > 0 { count += 1 }
    END {
      if (count + 0 != expected) {
        printf "Expected %s identity-preconditioned delete(s), found %s.\n", expected, count + 0 > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

_assert_file_contains()
{
  local file="$1"
  local needle="$2"
  awk -v needle="$needle" '
    index($0, needle) > 0 { found = 1 }
    END {
      if (!found) {
        printf "Expected file to contain: %s\n", needle > "/dev/stderr"
        exit 1
      }
    }
  ' "$file"
}

_assert_file_excludes()
{
  local file="$1"
  local needle="$2"
  awk -v needle="$needle" '
    index($0, needle) > 0 { found = 1 }
    END {
      if (found) {
        printf "Expected file to exclude: %s\n", needle > "/dev/stderr"
        exit 1
      }
    }
  ' "$file"
}

_assert_inventory_precedes_delete()
{
  awk '
    index($0, "get secret/sms1obot-mcp-server-mcp-run-shim ") == 1 && index($0, "custom-columns=") > 0 { snapshot = NR }
    index($0, "delete --raw ") == 1 && !first_delete { first_delete = NR }
    END {
      if (!snapshot || !first_delete || snapshot >= first_delete) {
        print "Expected the complete retirement inventory before the first delete." > "/dev/stderr"
        exit 1
      }
    }
  ' "$CALLS"
}

_assert_deploy_order()
{
  awk '
    index($0, "verify_legacy_obot_replacement_ready ") > 0 { ready = NR }
    index($0, "retire_legacy_obot_mcp_server_resources ") > 0 { retire = NR }
    index($0, "_post_deploy_verify ") == 1 { advisory = NR }
    END {
      if (!ready || !retire || !advisory || ready >= retire || retire >= advisory) {
        print "Expected replacement readiness, retirement, and advisory verification in order." > "/dev/stderr"
        exit 1
      }
    }
  ' "$DEPLOY"
}

_expect_retirement_success()
{
  if ! retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
    printf '%s\n' "Expected legacy Obot retirement to succeed." >&2
    return 1
  fi
}

_resource_from_uri()
{
  case "$1" in
    */deployments/*) printf 'deployment/%s' "${1##*/}" ;;
    */services/*) printf 'service/%s' "${1##*/}" ;;
    */secrets/*) printf 'secret/%s' "${1##*/}" ;;
    *) return 1 ;;
  esac
}

_replacement_image()
{
  case "$1" in
    deployment/opencrane-testv4-opencrane-server) printf '%s' "$SERVER_IMAGE" ;;
    deployment/opencrane-testv4-agent-controller) printf '%s' "$CONTROLLER_IMAGE" ;;
    deployment/opencrane-testv4-artifact-scanner) printf '%s' "$SCANNER_IMAGE" ;;
    deployment/opencrane-testv4-personal-warm|deployment/opencrane-testv4-managed-warm) printf '%s' "$RUNTIME_IMAGE" ;;
    *) return 1 ;;
  esac
}

kubectl()
{
  printf '%s\n' "$*" >>"$CALLS"
  if [[ "$1" == "rollout" ]]; then
    return 0
  fi
  if [[ "$1" == "delete" && "$2" == "--raw" ]]; then
    local deleted_resource
    local delete_options
    deleted_resource="$(_resource_from_uri "$3")"
    IFS= read -r delete_options
    printf 'delete-options %s %s\n' "$deleted_resource" "$delete_options" >>"$CALLS"
    if [[ "$deleted_resource" == "$RAW_DELETE_FAILURE_RESOURCE" ]]; then
      return 1
    fi
    return 0
  fi
  local resource="$2"
  local args="$*"
  if [[ "$args" == *"spec.template.spec.containers[0].image"* ]]; then
    _replacement_image "$resource"
    return
  fi
  if [[ "$args" == *"jsonpath={.metadata.uid}"* ]]; then
    if [[ "$resource" == "$REPLACEMENT_RESOURCE" ]]; then
      printf '%s' "replacement-uid"
    elif [[ "$resource" == "$RAW_DELETE_FAILURE_RESOURCE" ]]; then
      printf '%s' "uid-${resource#*/}"
    fi
    return 0
  fi
  if [[ "$args" == *"custom-columns=UID:.metadata.uid,RV:.metadata.resourceVersion"* ]]; then
    if [[ "$resource" == "$REPLACEMENT_RESOURCE" ]]; then
      printf '%s %s\n' "replacement-uid" "replacement-rv"
    elif [[ "$resource" == "$RAW_DELETE_FAILURE_RESOURCE" ]]; then
      if [[ "$resource" == "$UPDATED_RESOURCE" ]]; then
        printf '%s %s\n' "uid-${resource#*/}" "rv-updated"
      else
        printf '%s %s\n' "uid-${resource#*/}" "rv-1"
      fi
    fi
    return 0
  fi
  if [[ "$resource" == "$INSPECTION_FAILURE_RESOURCE" ]]; then
    return 1
  fi
  if [[ ",${FOUND_RESOURCES}," != *",${resource},"* ]]; then
    return 0
  fi
  local name="${resource#*/}"
  local uid="uid-${name}"
  local resource_version="rv-1"
  local hash="db3d4e4b60f0b6f402e41dfef18e4ecb2cfb49eb"
  local owner="sms1obot-mcp-server"
  if [[ "$resource" == "$MISMATCH_RESOURCE" ]]; then
    case "$MISMATCH_FIELD" in
      hash) hash="foreign-hash" ;;
      owner) owner="foreign-owner" ;;
      name) name="foreign-name" ;;
      missing-uid) uid="<none>" ;;
      missing-rv) resource_version="<none>" ;;
      missing-hash) hash="<none>" ;;
      missing-owner) owner="<none>" ;;
    esac
  fi
  printf '%s %s %s %s %s\n' "$name" "$uid" "$resource_version" "$hash" "$owner"
}

source "$RETIREMENT"

: >"$CALLS"
_assert_prefix_count 0 'delete --raw '

verify_legacy_obot_replacement_ready opencrane-testv4 opencrane-testv4 30 "$SERVER_IMAGE" "$CONTROLLER_IMAGE" "$SCANNER_IMAGE" "$RUNTIME_IMAGE" opencrane-testv4-artifact-scanning opencrane-testv4-runtime opencrane-testv4-managed-runtime || {
  printf '%s\n' "Expected legacy Obot replacement readiness to succeed." >&2
  exit 1
}
_assert_file_contains "$CALLS" 'rollout status deployment/opencrane-testv4-opencrane-server --namespace opencrane-testv4 --timeout=30s'
_assert_file_contains "$CALLS" 'rollout status deployment/opencrane-testv4-agent-controller --namespace opencrane-testv4 --timeout=30s'
_assert_file_contains "$CALLS" 'rollout status deployment/opencrane-testv4-artifact-scanner --namespace opencrane-testv4-artifact-scanning --timeout=30s'
_assert_file_contains "$CALLS" 'rollout status deployment/opencrane-testv4-personal-warm --namespace opencrane-testv4-runtime --timeout=30s'
_assert_file_contains "$CALLS" 'rollout status deployment/opencrane-testv4-managed-warm --namespace opencrane-testv4-managed-runtime --timeout=30s'
if verify_legacy_obot_replacement_ready opencrane-testv4 opencrane-testv4 30 "$SERVER_IMAGE" "$CONTROLLER_IMAGE" wrong-scanner-image "$RUNTIME_IMAGE" opencrane-testv4-artifact-scanning opencrane-testv4-runtime opencrane-testv4-managed-runtime; then
  echo "Obot replacement readiness accepted the wrong scanner image" >&2
  exit 1
fi

: >"$CALLS"
_expect_retirement_success
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
FOUND_RESOURCES="deployment/sms1obot-mcp-server,service/sms1obot-mcp-server,secret/sms1obot-mcp-server-mcp-config,secret/sms1obot-mcp-server-mcp-config-shim,secret/sms1obot-mcp-server-mcp-files,secret/sms1obot-mcp-server-mcp-run-shim"
_expect_retirement_success
_assert_prefix_count 6 'delete --raw '
_assert_identity_preconditioned_delete_count 6
_assert_file_contains "$CALLS" '--request-timeout=30s'
_assert_file_excludes "$CALLS" '-o json '
_assert_inventory_precedes_delete

: >"$CALLS"
MISMATCH_RESOURCE="service/sms1obot-mcp-server"
MISMATCH_FIELD="owner"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a foreign owner" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="hash"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a foreign Acorn hash" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="missing-hash"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted missing ownership evidence" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="missing-owner"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing owner" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="name"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted the wrong resource name" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="missing-uid"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing UID" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_FIELD="missing-rv"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing resource version" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
MISMATCH_RESOURCE=""
MISMATCH_FIELD=""
INSPECTION_FAILURE_RESOURCE="secret/sms1obot-mcp-server-mcp-config"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored an inventory failure" >&2
  exit 1
fi
_assert_prefix_count 0 'delete --raw '

: >"$CALLS"
INSPECTION_FAILURE_RESOURCE=""
FOUND_RESOURCES="secret/sms1obot-mcp-server-mcp-files"
_expect_retirement_success
_assert_prefix_count 1 'delete --raw '

: >"$CALLS"
REPLACEMENT_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
_expect_retirement_success
_assert_prefix_count 1 'delete --raw '

: >"$CALLS"
RAW_DELETE_FAILURE_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
REPLACEMENT_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a same-name UID replacement" >&2
  exit 1
fi
_assert_prefix_count 1 'delete --raw '

: >"$CALLS"
REPLACEMENT_RESOURCE=""
UPDATED_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a same-UID resource update" >&2
  exit 1
fi
_assert_prefix_count 1 'delete --raw '

: >"$CALLS"
UPDATED_RESOURCE=""
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a failed identity-preconditioned delete" >&2
  exit 1
fi
FOUND_RESOURCES=""
RAW_DELETE_FAILURE_RESOURCE=""
_expect_retirement_success
_assert_prefix_count 1 'delete --raw '
_assert_file_contains "$CALLS" '/api/v1/namespaces/opencrane-testv4/secrets/sms1obot-mcp-server-mcp-files'
_assert_file_excludes "$CALLS" 'delete-options secret/sms1obot-mcp-server-mcp-config '

_assert_file_contains "$DEPLOY" '[[ "$RELEASE_VERSION" == "0.10.0" && "$FROM_RELEASE_VERSION" == "0.9.2" && "$ALLOW_TAG_FLOAT" != "1" ]]'
_assert_file_contains "$DEPLOY" '[[ -z "$FINAL_SERVER_REPOSITORY" || -z "$FINAL_CONTROLLER_REPOSITORY" || -z "$FINAL_SCANNER_REPOSITORY" || -z "$FINAL_RUNTIME_REPOSITORY" ]]'
_assert_deploy_order

echo "legacy Obot retirement contract: PASS"
