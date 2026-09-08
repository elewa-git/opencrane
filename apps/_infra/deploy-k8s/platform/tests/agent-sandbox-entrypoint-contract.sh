#!/usr/bin/env bash
# Proves the shared controller action delegates before ordinary silo installation.
set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
cp "$PLATFORM_DIR/k8s-deploy.sh" "$TEST_DIRECTORY/k8s-deploy.sh"
cat > "$TEST_DIRECTORY/deploy-agent-sandbox-controller.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && "$1" == --context && "$2" == 'context with spaces' && "$3" == --preflight ]] || exit 99
exit 23
SH

status=0
bash "$TEST_DIRECTORY/k8s-deploy.sh" --provision-agent-sandbox-controller \
  --context 'context with spaces' --preflight || status=$?
if [[ "$status" != 23 ]]; then
  echo "Controller action did not preserve its arguments and exit status: $status" >&2
  exit 1
fi
echo 'Agent Sandbox core entrypoint contract: PASS'
