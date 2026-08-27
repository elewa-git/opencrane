#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AVAILABLE_KIB="${OPENCRANE_DEVCONTAINER_AVAILABLE_KIB:-$(df -Pk "$ROOT_DIR" | awk 'NR == 2 { print $4 }')}"
INSTALL_MODE="${OPENCRANE_DEVCONTAINER_INSTALL_DEPENDENCIES:-auto}"
RECOMMENDED_FREE_KIB="$((40 * 1024 * 1024))"

if [[ ! "$AVAILABLE_KIB" =~ ^[0-9]+$ ]]; then
  echo "OpenCrane devcontainer could not determine available storage." >&2
  exit 1
fi
if [[ "$INSTALL_MODE" != "auto" && "$INSTALL_MODE" != "0" && "$INSTALL_MODE" != "1" ]]; then
  echo "OPENCRANE_DEVCONTAINER_INSTALL_DEPENDENCIES must be 'auto', '0', or '1'." >&2
  exit 1
fi

if [[ "$INSTALL_MODE" == "1" ]] \
  || [[ "$INSTALL_MODE" == "auto" && "$AVAILABLE_KIB" -ge "$RECOMMENDED_FREE_KIB" ]]; then
  echo "Installing lockfile-bound workspace dependencies for the recommended host profile."
  npm ci
  exit 0
fi

echo "Skipping workspace dependency installation to preserve the minimum host's k3d disk budget."
echo "Tier 3 needs no host node_modules; use the recommended 64-GB host or set OPENCRANE_DEVCONTAINER_INSTALL_DEPENDENCIES=1 for other repository work."
npm cache clean --force >/dev/null 2>&1
