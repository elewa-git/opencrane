#!/usr/bin/env bash
set -euo pipefail

mcp_contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
mcp_contract_directory="$(mktemp -d)"
trap 'rm -rf "$mcp_contract_directory"' EXIT
mkdir "$mcp_contract_directory/bin"

# Every Kubernetes and random-material call is a local stub; no cluster or saved key is read.
cat > "$mcp_contract_directory/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "$MCP_KEYRING_TEST_DIRECTORY/calls"
if [[ "$1" == get ]]; then
  [[ "$*" == "get secret mcp-keyring -n server-test --ignore-not-found -o name" ]]
  case "$MCP_KEYRING_TEST_CASE" in
    existing) echo secret/mcp-keyring ;;
    read-failure) exit 1 ;;
    missing|create-conflict) ;;
    *) exit 2 ;;
  esac
  exit 0
fi
[[ "$1 $2 $3 $4 $5 $6" == "create secret generic mcp-keyring -n server-test" ]]
mcp_generated_file="${7#--from-file=keyring.json=}"
[[ -f "$mcp_generated_file" ]]
node -e 'const fs = require("node:fs"); if ((fs.statSync(process.argv[1]).mode & 0o777) !== 0o600) process.exit(1)' "$mcp_generated_file"
printf '%s\n' "$mcp_generated_file" > "$MCP_KEYRING_TEST_DIRECTORY/generated-path"
if [[ "$MCP_KEYRING_TEST_CASE" == create-conflict ]]; then
  exit 1
fi
echo secret/mcp-keyring
STUB

cat > "$mcp_contract_directory/bin/openssl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "rand -base64 32" ]]
echo generated >> "$MCP_KEYRING_TEST_DIRECTORY/calls"
echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
STUB
chmod +x "$mcp_contract_directory/bin/kubectl" "$mcp_contract_directory/bin/openssl"

for mcp_contract_case in existing read-failure missing create-conflict; do
  : > "$mcp_contract_directory/calls"
  rm -f "$mcp_contract_directory/generated-path"
  mcp_contract_status=0
  PATH="$mcp_contract_directory/bin:$PATH" MCP_KEYRING_TEST_DIRECTORY="$mcp_contract_directory" MCP_KEYRING_TEST_CASE="$mcp_contract_case" \
    bash "$mcp_contract_root/apps/opencrane/deploy/ensure-mcp-material-keyring.sh" server-test mcp-keyring > "$mcp_contract_directory/output" 2>&1 || mcp_contract_status=$?
  case "$mcp_contract_case" in
    existing|missing) [[ "$mcp_contract_status" == 0 ]] ;;
    read-failure|create-conflict) [[ "$mcp_contract_status" != 0 ]] ;;
  esac
  case "$mcp_contract_case" in
    existing|read-failure)
      [[ "$(cat "$mcp_contract_directory/calls")" == get ]]
      ;;
    missing|create-conflict)
      [[ "$(cat "$mcp_contract_directory/calls")" == $'get\ngenerated\ncreate' ]]
      [[ ! -e "$(cat "$mcp_contract_directory/generated-path")" ]]
      ;;
  esac
done
echo "MCP material keyring preservation contract: PASS"
