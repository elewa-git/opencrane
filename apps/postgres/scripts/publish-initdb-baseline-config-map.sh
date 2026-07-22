#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 || "$#" -gt 4 || ( "$#" -eq 4 && "$4" != "--verify-only" ) ]]; then
  echo "usage: $0 <namespace> <database-owner> <baseline-sql-file> [--verify-only]" >&2
  exit 64
fi

namespace="$1"
database_owner="$2"
baseline_file="$3"
verify_only="${4:-}"

if [[ ! -s "$baseline_file" ]]; then
  echo "database baseline is missing or empty: $baseline_file" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
rendered_baseline="$work_dir/target-baseline.sql"
quoted_owner="$(printf '%s' "$database_owner" | sed 's/"/""/g')"

function _sha256_file()
{
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# CNPG executes post-init references as the PostgreSQL superuser. Switch to the configured
# application owner in the same SQL file so every created object remains app-owned.
printf 'SET ROLE "%s";\n\n' "$quoted_owner" >"$rendered_baseline"
cat "$baseline_file" >>"$rendered_baseline"

baseline_digest="$(_sha256_file "$rendered_baseline")"
config_map_name="opencrane-database-baseline-${baseline_digest:0:16}"

if kubectl get configmap "$config_map_name" -n "$namespace" >/dev/null 2>&1; then
  existing_baseline="$work_dir/existing-target-baseline.sql"
  kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.data.target-baseline\.sql}' >"$existing_baseline"
  existing_content_digest="$(_sha256_file "$existing_baseline")"
  existing_annotation_digest="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
  existing_immutable="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.immutable}')"
  if [[ "$existing_immutable" != "true" \
    || "$existing_annotation_digest" != "$baseline_digest" \
    || "$existing_content_digest" != "$baseline_digest" ]]; then
    echo "existing baseline ConfigMap $config_map_name is not immutable or its SQL bytes do not match the expected digest" >&2
    exit 1
  fi
  printf '%s\n' "$config_map_name"
  exit 0
fi
if [[ "$verify_only" == "--verify-only" ]]; then
  echo "expected immutable baseline ConfigMap $config_map_name does not exist" >&2
  exit 1
fi

kubectl create configmap "$config_map_name" \
  -n "$namespace" \
  --from-file="target-baseline.sql=$rendered_baseline" \
  --dry-run=client \
  -o json \
  | kubectl patch --local -f - --type=merge \
      -p "{\"immutable\":true,\"metadata\":{\"annotations\":{\"opencrane.ai/baseline-sha256\":\"$baseline_digest\"}}}" \
      -o yaml \
  | kubectl apply -f - >/dev/null

printf '%s\n' "$config_map_name"
