#!/usr/bin/env bash
set -euo pipefail
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
helm template tool-runner apps/tool-runner/helm > "$manifest"
grep -Fq 'name: opencrane-tools' "$manifest"
grep -Fq 'name: tool-runner-default' "$manifest"
grep -Fq 'automountServiceAccountToken: false' "$manifest"
grep -Fq 'name: tool-runner-default-deny' "$manifest"
grep -Fq 'ingress: []' "$manifest"
grep -Fq 'egress: []' "$manifest"
if helm template tool-runner apps/tool-runner/helm --set toolRunner.serviceAccountName=skill-authoring-default >/dev/null 2>&1; then exit 1; fi
if helm template tool-runner apps/tool-runner/helm --namespace opencrane --set toolRunner.namespace=opencrane >/dev/null 2>&1; then exit 1; fi
if helm template tool-runner apps/tool-runner/helm --set toolRunner.quota.pods=11 >/dev/null 2>&1; then exit 1; fi
