#!/usr/bin/env bash
# Checks the explicit operator-configuration documentation contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPOSITORY_ROOT"
exec node "$SCRIPT_DIR/config-docs-coverage.mjs" "$@"
