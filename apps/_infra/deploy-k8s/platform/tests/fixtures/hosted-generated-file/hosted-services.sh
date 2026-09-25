#!/usr/bin/env bash
set -euo pipefail

MODE="${1:?mode is required}"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in
  prepare|start-registry) exec bash "$FIXTURE_DIR/registry-fixture.sh" "$@" ;;
  start-protocol|stop) exec bash "$FIXTURE_DIR/protocol-service.sh" "$@" ;;
  *) echo "[hosted-services] Unknown mode: $MODE" >&2; exit 1 ;;
esac
