#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

rendered="$(helm template opencrane-silo "$CHART_DIR" \
  --set-string opencrane-skill-authoring.skillAuthoring.namespace=authoring-contract \
  --set-string opencrane-skill-authoring.skillAuthoring.quota.pods=7 \
  --set-string opencrane-tool-runner.toolRunner.namespace=tool-contract \
  --set-string opencrane-tool-runner.toolRunner.quota.jobs=6)"

grep -Fq 'name: authoring-contract' <<<"$rendered"
grep -Fq 'namespace: authoring-contract' <<<"$rendered"
grep -Fq 'pods: "7"' <<<"$rendered"
grep -Fq 'name: tool-contract' <<<"$rendered"
grep -Fq 'namespace: tool-contract' <<<"$rendered"
grep -Fq 'count/jobs.batch: "6"' <<<"$rendered"

echo "skill workload umbrella contract: PASS"
