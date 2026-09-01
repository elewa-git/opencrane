#!/usr/bin/env bash
set -euo pipefail

[[ "$(node --version)" == v24.* ]] || { echo "Expected Node 24." >&2; exit 1; }
[[ "$(helm version --short)" == v4.1.4* ]] || { echo "Expected Helm v4.1.4." >&2; exit 1; }
[[ "$(k3d version | head -1)" == "k3d version v5.8.3" ]] || { echo "Expected k3d v5.8.3." >&2; exit 1; }
kubectl version --client --output=json | jq -e '.clientVersion.gitVersion == "v1.30.10"' >/dev/null
docker info >/dev/null
# Fail setup if Docker cannot reclaim cache to a minimum free-space target.
docker buildx prune --help | grep -q -- '--min-free-space'

echo "OpenCrane Tier 3 tools are ready."
