#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 4 || "$#" -gt 5 || ( "$#" -eq 5 && "$5" != "--verify-only" ) ]]; then
	echo "usage: $0 <namespace> <migration-id> <migration-sql-file> <expected-sha256> [--verify-only]" >&2
	exit 64
fi

namespace="$1"
migration_id="$2"
migration_sql_file="$3"
expected_sha256="$4"
verify_only="${5:-}"

if [[ ! "$migration_id" =~ ^[0-9]+\.[0-9]+\.[0-9]+-to-[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "migration id is not an exact version transition: $migration_id" >&2
	exit 1
fi
if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ || ! -s "$migration_sql_file" ]]; then
	echo "migration SQL or expected digest is invalid" >&2
	exit 1
fi

sha256_file()
{
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

actual_sha256="$(sha256_file "$migration_sql_file")"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
	echo "migration SQL digest '$actual_sha256' does not match manifest '$expected_sha256'" >&2
	exit 1
fi

config_map_name="opencrane-database-migration-${migration_id//./-}-${expected_sha256:0:16}"
if kubectl get configmap "$config_map_name" -n "$namespace" >/dev/null 2>&1; then
	existing_sql="$(mktemp)"
	trap 'rm -f "$existing_sql"' EXIT
	kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.data.migration\.sql}' >"$existing_sql"
	existing_sha256="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.metadata.annotations.opencrane\.ai/migration-sql-sha256}')"
	existing_immutable="$(kubectl get configmap "$config_map_name" -n "$namespace" -o jsonpath='{.immutable}')"
	if [[ "$existing_immutable" != "true" || "$existing_sha256" != "$expected_sha256" || "$(sha256_file "$existing_sql")" != "$expected_sha256" ]]; then
		echo "existing migration ConfigMap $config_map_name is not immutable or its SQL bytes do not match" >&2
		exit 1
	fi
	printf '%s\n' "$config_map_name"
	exit 0
fi
if [[ "$verify_only" == "--verify-only" ]]; then
	echo "expected immutable migration ConfigMap $config_map_name does not exist" >&2
	exit 1
fi

rendered_config_map="$(mktemp)"
trap 'rm -f "$rendered_config_map"' EXIT
kubectl create configmap "$config_map_name" \
	--namespace "$namespace" \
	--from-file="migration.sql=$migration_sql_file" \
	--dry-run=client \
	-o json \
	| kubectl patch --local -f - --type=merge \
		-p "{\"immutable\":true,\"metadata\":{\"annotations\":{\"opencrane.ai/migration-id\":\"$migration_id\",\"opencrane.ai/migration-sql-sha256\":\"$expected_sha256\"}}}" \
		-o yaml >"$rendered_config_map"

# Another deployment may publish the same content-addressed object after the initial lookup.
# Accept that race only when one bounded read-back verifies the winner's immutable bytes.
if ! kubectl create -f "$rendered_config_map" >/dev/null; then
	bash "$0" "$namespace" "$migration_id" "$migration_sql_file" "$expected_sha256" --verify-only >/dev/null
fi
printf '%s\n' "$config_map_name"
