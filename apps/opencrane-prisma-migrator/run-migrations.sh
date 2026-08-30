#!/bin/sh
set -eu

prisma_cli="${PRISMA_CLI:-/app/node_modules/.bin/prisma}"
psql_cli="${PSQL_CLI:-/usr/bin/psql}"
prerequisite_sql="${IAM_PREREQUISITE_SQL:-/app/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql}"
source_baseline_sha256="5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f"
baseline_migration="20260826000000_0_9_2_baseline"
workflow_cutover_migration="20260827000000_0_10_0_workflow_cutover"

if [ "${OPENCRANE_MIGRATION_SOURCE_VERSION:-}" != "0.9.2" ]; then
	echo "The migration Job only accepts the tagged 0.9.2 database as its starting point." >&2
	exit 1
fi
if [ -z "${DATABASE_URL:-}" ] || [ -z "${OPENCRANE_MIGRATION_SILO_ID:-}" ] || [ -z "${OPENCRANE_MIGRATION_OIDC_ISSUER:-}" ]; then
	echo "DATABASE_URL, OPENCRANE_MIGRATION_SILO_ID, and OPENCRANE_MIGRATION_OIDC_ISSUER are required." >&2
	exit 1
fi
if [ ! -f "$prerequisite_sql" ]; then
	echo "The reviewed 0.9.2 IAM prerequisite SQL is missing." >&2
	exit 1
fi

prerequisite_sql_sha256="$(sha256sum "$prerequisite_sql" | cut -d ' ' -f1)"
"$psql_cli" --dbname "$DATABASE_URL" --set ON_ERROR_STOP=on \
	--set "source_baseline_sha256=$source_baseline_sha256" \
	--set "migration_sql_sha256=$prerequisite_sql_sha256" \
	--set "migration_silo_id=$OPENCRANE_MIGRATION_SILO_ID" \
	--set "migration_oidc_issuer=$OPENCRANE_MIGRATION_OIDC_ISSUER" \
	--file "$prerequisite_sql"

baseline_output="$(mktemp)"
cutover_output="$(mktemp)"
trap 'rm -f "$baseline_output" "$cutover_output"' EXIT

# The prerequisite prepares tagged 0.9.2's schema before Prisma starts. Mark the empty bridge as
# applied so Prisma deploys the forward cutover without replaying pre-0.10 schema history.
if ! "$prisma_cli" migrate resolve --applied "$baseline_migration" >"$baseline_output" 2>&1; then
	if ! grep -q 'P3008' "$baseline_output"; then
		cat "$baseline_output" >&2
		exit 1
	fi
fi

# The cutover SQL runs in one database transaction, so a failure leaves no schema changes to undo.
# Mark its failed Prisma record as rolled back before a repaired image retries it. P3011 means the
# migration was never applied, and P3012 means it is not failed, so neither case needs recovery.
if ! "$prisma_cli" migrate resolve --rolled-back "$workflow_cutover_migration" >"$cutover_output" 2>&1; then
	if ! grep -Eq 'P3011|P3012' "$cutover_output"; then
		cat "$cutover_output" >&2
		exit 1
	fi
fi

exec "$prisma_cli" migrate deploy
