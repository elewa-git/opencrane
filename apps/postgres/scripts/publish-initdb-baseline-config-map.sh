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
baseline_identity_input="$work_dir/baseline-identity.sql"
rendered_baseline="$work_dir/target-baseline.sql"
rendered_config_map="$work_dir/baseline-config-map.yaml"
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

# Hash the privileged pg_cron setup, application-owner transition, and target SQL. The envelope
# version changes whenever the protected origin contract changes.
printf '%s\n' '-- OpenCrane initdb baseline envelope v2.' >"$baseline_identity_input"
printf '%s\n' 'CREATE EXTENSION IF NOT EXISTS pg_cron;' >>"$baseline_identity_input"
printf 'GRANT USAGE ON SCHEMA "cron" TO "%s";\n' "$quoted_owner" >>"$baseline_identity_input"
printf 'SET ROLE "%s";\n\n' "$quoted_owner" >>"$baseline_identity_input"
cat "$baseline_file" >>"$baseline_identity_input"

baseline_digest="$(_sha256_file "$baseline_identity_input")"
config_map_name="opencrane-database-baseline-${baseline_digest:0:16}"

# CNPG executes post-init references as the PostgreSQL superuser. Record the baseline identity in
# a superuser-owned schema before switching to the application owner. Physical recovery carries
# this protected row with the database, so deploy verification never trusts caller-supplied labels.
printf '%s\n' \
  'CREATE SCHEMA "opencrane_bootstrap" AUTHORIZATION CURRENT_USER;' \
  'REVOKE ALL ON SCHEMA "opencrane_bootstrap" FROM PUBLIC;' \
  'CREATE TABLE "opencrane_bootstrap"."target_baseline" (' \
  '    "singleton" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("singleton"),' \
  '    "baseline_sha256" TEXT NOT NULL CHECK ("baseline_sha256" ~ '\''^[0-9a-f]{64}$'\'')' \
  ');' \
  "INSERT INTO \"opencrane_bootstrap\".\"target_baseline\" (\"singleton\", \"baseline_sha256\") VALUES (TRUE, '$baseline_digest');" \
  "GRANT USAGE ON SCHEMA \"opencrane_bootstrap\" TO \"$quoted_owner\";" \
  "GRANT SELECT ON TABLE \"opencrane_bootstrap\".\"target_baseline\" TO \"$quoted_owner\";" \
  >"$rendered_baseline"
cat "$baseline_identity_input" >>"$rendered_baseline"
rendered_digest="$(_sha256_file "$rendered_baseline")"

if kubectl get configmap "$config_map_name" -n "$namespace" >/dev/null 2>&1; then
  existing_baseline="$work_dir/existing-target-baseline.sql"
  kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.data.target-baseline\.sql}' >"$existing_baseline"
  existing_content_digest="$(_sha256_file "$existing_baseline")"
  existing_baseline_digest="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
  existing_immutable="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.immutable}')"
  if [[ "$existing_immutable" != "true" \
    || "$existing_baseline_digest" != "$baseline_digest" \
    || "$existing_content_digest" != "$rendered_digest" ]]; then
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
      -o yaml >"$rendered_config_map"

# Another deployment may publish the same content-addressed object after the initial lookup.
# Accept that race only when the winner's immutable bytes pass the verification above.
if ! kubectl create -f "$rendered_config_map" >/dev/null; then
  bash "$0" "$namespace" "$database_owner" "$baseline_file" --verify-only >/dev/null
fi

printf '%s\n' "$config_map_name"
