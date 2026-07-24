#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s"

rendered="$(helm template opencrane-silo "$CHART_DIR" \
  --set agentController.enabled=true \
  --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string agentController.skillWorkloadProfiles.authoring.image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  --set-string agentController.skillWorkloadProfiles.toolRunner.image.digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --set-string 'agentController.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string agentController.openCraneInternalUrl=http://override.example:8081 \
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
grep -Fq 'http://opencrane-silo-opencrane-server.default.svc.cluster.local:8081/api/internal/agent-runtime' <<<"$rendered"
if grep -A60 -F 'kind: ValidatingAdmissionPolicy' <<<"$rendered" | grep -Fq 'http://override.example:8081/api/internal/agent-runtime'; then
  echo "governed skill bootstrap inherited the mutable controller endpoint" >&2
  exit 1
fi

echo "skill workload umbrella contract: PASS"
