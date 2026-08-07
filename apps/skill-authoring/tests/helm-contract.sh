#!/usr/bin/env bash
set -euo pipefail
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
helm template skill-authoring apps/skill-authoring/helm > "$manifest"
grep -Fq 'name: opencrane-skill-authoring' "$manifest"
grep -Fq 'name: skill-authoring-default' "$manifest"
grep -Fq 'automountServiceAccountToken: false' "$manifest"
grep -Fq 'name: skill-authoring-default-deny' "$manifest"
grep -Fq 'ingress: []' "$manifest"
grep -Fq 'egress: []' "$manifest"
grep -Fq 'requests.memory: "4Gi"' "$manifest"
grep -Fq 'limits.memory: "4Gi"' "$manifest"
if helm template skill-authoring apps/skill-authoring/helm --set skillAuthoring.serviceAccountName=tool-runner-default >/dev/null 2>&1; then exit 1; fi
if helm template skill-authoring apps/skill-authoring/helm --namespace opencrane --set skillAuthoring.namespace=opencrane >/dev/null 2>&1; then exit 1; fi
if helm template skill-authoring apps/skill-authoring/helm --set skillAuthoring.quota.pods=11 >/dev/null 2>&1; then exit 1; fi
