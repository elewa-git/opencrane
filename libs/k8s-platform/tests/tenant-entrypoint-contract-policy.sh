#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"

function _cleanup()
{
  rm -rf "$TMP_DIR"
}

function _assert_no_match()
{
  local pattern="$1"
  local path="$2"
  local status=0

  grep -RqsE -- "$pattern" "$path" || status=$?
  case "$status" in
    0)
      echo "[tenant-entrypoint] ERROR: retired runtime path remains under $path" >&2
      return 1
      ;;
    1)
      return 0
      ;;
    *)
      echo "[tenant-entrypoint] ERROR: unable to inspect $path" >&2
      return "$status"
      ;;
  esac
}

trap _cleanup EXIT

cat > "$TMP_DIR/contract.json" <<'EOF'
{
  "policy": { "mcpServers": { "allow": ["github"], "deny": ["admin"] } },
  "capabilities": { "mcpPolicyEnforced": true }
}
EOF

export OPENCRANE_RUNTIME_CONTRACT_PATH="$TMP_DIR/contract.json"
export OPENCRANE_RUNTIME_CONTRACT_WRITABLE="$TMP_DIR/missing.json"
source "$ROOT_DIR/apps/feat-openclaw-tenant/deploy/entrypoint.sh"
_load_mcp_policy

[[ "$OPENCRANE_ALLOWED_MCP_SERVERS" == "github" ]]
[[ "$OPENCRANE_DENIED_MCP_SERVERS" == "admin" ]]
[[ "$OPENCRANE_MCP_POLICY_ENFORCED" == "true" ]]

_assert_no_match 'OPENCRANE_TENANT_MCP|shared-skills|OPENCRANE_SHARED_SKILLS' "$ROOT_DIR/apps/feat-openclaw-tenant"

echo "[tenant-entrypoint] PASS: effective-contract MCP policy retained without Tenant-CRD/shared-skill paths"
