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
    delete_options="$(<&0)"
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

verify_legacy_obot_replacement_ready opencrane-testv4 opencrane-testv4 30 "$SERVER_IMAGE" "$CONTROLLER_IMAGE" "$SCANNER_IMAGE" "$RUNTIME_IMAGE" opencrane-testv4-artifact-scanning opencrane-testv4-runtime opencrane-testv4-managed-runtime
grep -Fq 'rollout status deployment/opencrane-testv4-opencrane-server --namespace opencrane-testv4 --timeout=30s' "$CALLS"
grep -Fq 'rollout status deployment/opencrane-testv4-agent-controller --namespace opencrane-testv4 --timeout=30s' "$CALLS"
grep -Fq 'rollout status deployment/opencrane-testv4-artifact-scanner --namespace opencrane-testv4-artifact-scanning --timeout=30s' "$CALLS"
grep -Fq 'rollout status deployment/opencrane-testv4-personal-warm --namespace opencrane-testv4-runtime --timeout=30s' "$CALLS"
grep -Fq 'rollout status deployment/opencrane-testv4-managed-warm --namespace opencrane-testv4-managed-runtime --timeout=30s' "$CALLS"
if verify_legacy_obot_replacement_ready opencrane-testv4 opencrane-testv4 30 "$SERVER_IMAGE" "$CONTROLLER_IMAGE" wrong-scanner-image "$RUNTIME_IMAGE" opencrane-testv4-artifact-scanning opencrane-testv4-runtime opencrane-testv4-managed-runtime; then
  echo "Obot replacement readiness accepted the wrong scanner image" >&2
  exit 1
fi

: >"$CALLS"
retire_legacy_obot_mcp_server_resources opencrane-testv4 30
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
FOUND_RESOURCES="deployment/sms1obot-mcp-server,service/sms1obot-mcp-server,secret/sms1obot-mcp-server-mcp-config,secret/sms1obot-mcp-server-mcp-config-shim,secret/sms1obot-mcp-server-mcp-files,secret/sms1obot-mcp-server-mcp-run-shim"
retire_legacy_obot_mcp_server_resources opencrane-testv4 30
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "6" ]]
[[ "$(grep -c '^delete-options .*\"preconditions\":{\"uid\":\"uid-.*\"resourceVersion\":\"rv-1\"' "$CALLS")" == "6" ]]
grep -Fq -- '--request-timeout=30s' "$CALLS"
! grep -q -- '-o json ' "$CALLS"
last_snapshot_line="$(grep -n 'get secret/sms1obot-mcp-server-mcp-run-shim .*custom-columns=' "$CALLS" | cut -d: -f1)"
first_delete_line="$(grep -n '^delete --raw ' "$CALLS" | head -1 | cut -d: -f1)"
[[ "$last_snapshot_line" -lt "$first_delete_line" ]]

: >"$CALLS"
MISMATCH_RESOURCE="service/sms1obot-mcp-server"
MISMATCH_FIELD="owner"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a foreign owner" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="hash"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a foreign Acorn hash" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="missing-hash"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted missing ownership evidence" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="missing-owner"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing owner" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="name"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted the wrong resource name" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="missing-uid"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing UID" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_FIELD="missing-rv"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement accepted a missing resource version" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
MISMATCH_RESOURCE=""
MISMATCH_FIELD=""
INSPECTION_FAILURE_RESOURCE="secret/sms1obot-mcp-server-mcp-config"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored an inventory failure" >&2
  exit 1
fi
! grep -q '^delete --raw ' "$CALLS"

: >"$CALLS"
INSPECTION_FAILURE_RESOURCE=""
FOUND_RESOURCES="secret/sms1obot-mcp-server-mcp-files"
retire_legacy_obot_mcp_server_resources opencrane-testv4 30
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "1" ]]

: >"$CALLS"
REPLACEMENT_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
retire_legacy_obot_mcp_server_resources opencrane-testv4 30
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "1" ]]

: >"$CALLS"
RAW_DELETE_FAILURE_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
REPLACEMENT_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a same-name UID replacement" >&2
  exit 1
fi
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "1" ]]

: >"$CALLS"
REPLACEMENT_RESOURCE=""
UPDATED_RESOURCE="secret/sms1obot-mcp-server-mcp-files"
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a same-UID resource update" >&2
  exit 1
fi
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "1" ]]

: >"$CALLS"
UPDATED_RESOURCE=""
if retire_legacy_obot_mcp_server_resources opencrane-testv4 30; then
  echo "Obot retirement ignored a failed identity-preconditioned delete" >&2
  exit 1
fi
FOUND_RESOURCES=""
RAW_DELETE_FAILURE_RESOURCE=""
retire_legacy_obot_mcp_server_resources opencrane-testv4 30
[[ "$(grep -c '^delete --raw ' "$CALLS")" == "1" ]]
grep -Fq '/api/v1/namespaces/opencrane-testv4/secrets/sms1obot-mcp-server-mcp-files' "$CALLS"
! grep -q '^delete-options secret/sms1obot-mcp-server-mcp-config ' "$CALLS"

grep -Fq '[[ "$RELEASE_VERSION" == "0.10.0" && "$FROM_RELEASE_VERSION" == "0.9.3" && "$ALLOW_TAG_FLOAT" != "1" ]]' "$DEPLOY"
grep -Fq '[[ -z "$FINAL_SERVER_REPOSITORY" || -z "$FINAL_CONTROLLER_REPOSITORY" || -z "$FINAL_SCANNER_REPOSITORY" || -z "$FINAL_RUNTIME_REPOSITORY" ]]' "$DEPLOY"
ready_line="$(grep -n 'verify_legacy_obot_replacement_ready ' "$DEPLOY" | tail -1 | cut -d: -f1)"
retire_line="$(grep -n 'retire_legacy_obot_mcp_server_resources ' "$DEPLOY" | tail -1 | cut -d: -f1)"
advisory_line="$(grep -n '^_post_deploy_verify ' "$DEPLOY" | tail -1 | cut -d: -f1)"
[[ "$ready_line" -lt "$retire_line" && "$retire_line" -lt "$advisory_line" ]]

echo "legacy Obot retirement contract: PASS"
