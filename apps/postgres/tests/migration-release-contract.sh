#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RESOLVER="$ROOT_DIR/scripts/release-versioning/database-transition.mjs"
CURRENT_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")"

fresh="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" fresh)"
current="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" "$CURRENT_VERSION")"
previous="$(jq -r '.previousRepositoryVersion' "$ROOT_DIR/releases/$CURRENT_VERSION.json")"
migration="$(node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" "$previous")"

[[ "$(jq -r '.kind' <<<"$fresh")" == "fresh" ]]
[[ "$(jq -r '.kind' <<<"$current")" == "current" ]]
[[ "$(jq -r '.kind' <<<"$migration")" == "current" ]]
[[ "$(jq -r '.migration' <<<"$migration")" == "null" ]]

if node "$RESOLVER" "$ROOT_DIR" "$CURRENT_VERSION" 0.7 >/dev/null 2>&1; then
  echo "release resolver accepted an inexact source version" >&2
  exit 1
fi
if node "$RESOLVER" "$ROOT_DIR" 0.7.0 "$CURRENT_VERSION" >/dev/null 2>&1; then
  echo "release resolver accepted a target other than the current root release" >&2
  exit 1
fi

echo "postgres migration release contract: PASS"
