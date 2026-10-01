#!/usr/bin/env bash
# Suspend the repository-reviewed OpenCrane development test silos while retaining their data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/platform/k8s-suspend.sh"
INVENTORY="$SCRIPT_DIR/suspendible-test-silos.json"

CONTEXT=""
CONFIRM_SUSPEND=""
SETTLE_TIMEOUT_SECONDS="600"
PREFLIGHT="0"

err()
{
	printf '\033[0;31m[silo-suspend]\033[0m %s\n' "$1" >&2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--context) CONTEXT="$2"; shift 2 ;;
		--confirm-suspend) CONFIRM_SUSPEND="$2"; shift 2 ;;
		--settle-timeout-seconds) SETTLE_TIMEOUT_SECONDS="$2"; shift 2 ;;
		--preflight) PREFLIGHT="1"; shift ;;
		-h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) err "Unknown flag: $1"; exit 1 ;;
	esac
done

[[ -f "$INVENTORY" ]] || { err "Reviewed test-silo inventory is missing."; exit 1; }
[[ "$SETTLE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
	err "--settle-timeout-seconds must be a positive integer."
	exit 1
}
(( SETTLE_TIMEOUT_SECONDS <= 3600 )) || { err "--settle-timeout-seconds must not exceed 3600."; exit 1; }

ARGS=(
	--context "$CONTEXT"
	--inventory "$INVENTORY"
	--confirm-suspend "$CONFIRM_SUSPEND"
	--settle-timeout-seconds "$SETTLE_TIMEOUT_SECONDS"
)
[[ "$PREFLIGHT" == "0" ]] || ARGS+=(--preflight)
exec "$CORE" "${ARGS[@]}"
