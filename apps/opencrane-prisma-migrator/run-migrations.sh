#!/bin/sh
set -eu

prisma_cli="${PRISMA_CLI:-/app/node_modules/.bin/prisma}"
baseline_migration="20260826000000_0_9_3_baseline"

if [ "${OPENCRANE_MIGRATION_SOURCE_VERSION:-}" != "0.9.3" ]; then
	echo "The Prisma migrator only accepts the released 0.9.3 database as its starting point." >&2
	exit 1
fi

baseline_output="$(mktemp)"
trap 'rm -f "$baseline_output"' EXIT

# A released 0.9.3 database has no Prisma ledger entry. Mark its empty baseline as applied so
# Prisma deploys the forward cutover migration without replaying released schema history.
if ! "$prisma_cli" migrate resolve --applied "$baseline_migration" >"$baseline_output" 2>&1; then
	if ! grep -q 'P3008' "$baseline_output"; then
		cat "$baseline_output" >&2
		exit 1
	fi
fi

exec "$prisma_cli" migrate deploy
