#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"

prepare_current_chart_sources
trap cleanup_current_chart_sources EXIT
CHART_DIR="$(current_chart_sources_dir)"

rendered="$(helm template opencrane-silo "$CHART_DIR")"
cleanup_rbac="$(printf '%s\n' "$rendered" | awk '
  function flush_document() {
    if ((is_role || is_binding) && is_cleanup_name) {
      printf "%s---\n", document
    }
    document = ""
    is_role = 0
    is_binding = 0
    is_cleanup_name = 0
  }
  /^---$/ {
    flush_document()
    next
  }
  {
    document = document $0 ORS
  }
  /^kind: Role$/ {
    is_role = 1
  }
  /^kind: RoleBinding$/ {
    is_binding = 1
  }
  /^  name: opencrane-silo-runtime-cleanup$/ {
    is_cleanup_name = 1
  }
  END {
    flush_document()
  }
')"

[[ "$(grep -xc 'kind: Role' <<<"$cleanup_rbac")" -eq 2 ]]
[[ "$(grep -xc 'kind: RoleBinding' <<<"$cleanup_rbac")" -eq 2 ]]
grep -Fq '  namespace: opencrane-silo-runtime' <<<"$cleanup_rbac"
grep -Fq '  namespace: opencrane-silo-managed-runtime' <<<"$cleanup_rbac"
[[ "$(grep -Fc '    resources: ["jobs"]' <<<"$cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '    verbs: ["get", "delete"]' <<<"$cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '  name: opencrane-silo-opencrane-server' <<<"$cleanup_rbac")" -eq 2 ]]
[[ "$(grep -Fc '    namespace: default' <<<"$cleanup_rbac")" -eq 2 ]]

if grep -Eq 'verbs:.*(create|patch|update|list|watch)|resources:.*(pods|secrets|deployments)' <<<"$cleanup_rbac"; then
  echo "opencrane-server runtime cleanup RBAC exceeds exact Job get/delete authority" >&2
  exit 1
fi

echo "opencrane-server runtime cleanup RBAC contract: PASS"
