#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RESOLVER="$ROOT_DIR/scripts/release-versioning/database-transition.mjs"
CURRENT_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")"

fresh="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" fresh)"
current="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" "$CURRENT_VERSION")"
previous="$(jq -r '.previousRepositoryVersion' "$ROOT_DIR/releases/$CURRENT_VERSION.json")"
migration_source="$(jq -r '.database.carriedForwardFromRepositoryVersion // .previousRepositoryVersion' \
  "$ROOT_DIR/releases/$CURRENT_VERSION.json")"
MIGRATION_RESOLVER="$RESOLVER"
if [[ "$CURRENT_VERSION" == "0.9.3" && "$migration_source" == "0.9.2" ]]; then
	MIGRATION_RESOLVER="$ROOT_DIR/scripts/release-versioning/database-transition-0.9.3.mjs"
fi
migration="$(node "$MIGRATION_RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" "$migration_source")"
previous_schema="$(jq -r '.database.schemaVersion' "$ROOT_DIR/releases/$migration_source.json")"
target_schema="$(jq -r '.database.schemaVersion' "$ROOT_DIR/releases/$CURRENT_VERSION.json")"
expected_migration_id="${previous_schema}-to-${target_schema}"

[[ "$(jq -r '.kind' <<<"$fresh")" == "fresh" ]]
[[ "$(jq -r '.kind' <<<"$current")" == "current" ]]
# A release that keeps the schema needs no migration, so the resolver reports the database as current.
if [[ "$previous_schema" == "$target_schema" ]]; then
	[[ "$(jq -r '.kind' <<<"$migration")" == "current" ]]
else
	[[ "$(jq -r '.kind' <<<"$migration")" == "migration" ]]
	[[ "$(jq -r '.migration.id' <<<"$migration")" == "$expected_migration_id" ]]
	[[ "$(jq -r '.migration.fromSchemaVersion' <<<"$migration")" == "$previous_schema" ]]
	[[ "$(jq -r '.migration.toSchemaVersion' <<<"$migration")" == "$target_schema" ]]
	if [[ "$migration_source" != "$previous" ]]; then
		predecessor="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" "$previous")"
		[[ "$(jq -r '.kind' <<<"$predecessor")" == "current" ]]
	fi
	jq -e '
  .migration.sourceProtectedBaselineSha256s as $origins
  | .migration.sourceHistoryLineages as $lineages
  | ($origins | type == "array" and length > 0)
    and ($lineages | type == "array" and length == ($origins | length))
    and ([range(0; $origins | length) as $index
      | $lineages[$index].sourceProtectedBaselineSha256 == $origins[$index]] | all)
' <<<"$migration" >/dev/null
fi

if node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" 0.7 >/dev/null 2>&1; then
  echo "release resolver accepted an inexact source version" >&2
  exit 1
fi
if node "$RESOLVER" "$ROOT_DIR" 0.7.0 "$CURRENT_VERSION" >/dev/null 2>&1; then
  echo "release resolver accepted a target other than the current root release" >&2
  exit 1
fi

echo "postgres migration release contract: PASS"
