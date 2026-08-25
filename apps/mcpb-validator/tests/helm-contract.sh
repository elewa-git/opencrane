#!/usr/bin/env bash
set -euo pipefail
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
helm template mcpb-validator apps/mcpb-validator/helm > "$manifest"
grep -Fq 'name: opencrane-mcpb-validation' "$manifest"
grep -Fq 'name: mcpb-validator-default' "$manifest"
grep -Fq 'automountServiceAccountToken: false' "$manifest"
grep -Fq 'name: mcpb-validator-default-deny' "$manifest"
grep -Fq 'ingress: []' "$manifest"
grep -Fq 'egress: []' "$manifest"
if helm template mcpb-validator apps/mcpb-validator/helm --set mcpbValidator.serviceAccountName=tool-runner-default >/dev/null 2>&1; then exit 1; fi
if helm template mcpb-validator apps/mcpb-validator/helm --namespace opencrane --set mcpbValidator.namespace=opencrane >/dev/null 2>&1; then exit 1; fi
if helm template mcpb-validator apps/mcpb-validator/helm --set mcpbValidator.quota.pods=11 >/dev/null 2>&1; then exit 1; fi
