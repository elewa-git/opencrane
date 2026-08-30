#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENTRYPOINT="$ROOT/apps/opencrane-prisma-migrator/run-migrations.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat >"$TEST_DIR/prisma" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$PRISMA_CALLS"
case "$PRISMA_SCENARIO:$*" in
	baseline-applied:"migrate resolve --applied 20260826000000_0_9_2_baseline")
		echo "Error: P3008" >&2
		exit 1
		;;
	cutover-missing:"migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover")
		echo "Error: P3011" >&2
		exit 1
		;;
	cutover-complete:"migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover")
		echo "Error: P3012" >&2
		exit 1
		;;
	cutover-resolve-fails:"migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover")
		echo "unexpected database error" >&2
		exit 1
		;;
	deploy-fails:"migrate deploy")
		exit 1
		;;
esac
MOCK
chmod +x "$TEST_DIR/prisma"

cat >"$TEST_DIR/psql" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$PSQL_CALLS"
if [ "$PSQL_SCENARIO" = "prerequisite-fails" ]; then
	exit 1
fi
MOCK
chmod +x "$TEST_DIR/psql"

run_scenario()
{
	local scenario="$1"
	: >"$TEST_DIR/calls"
	: >"$TEST_DIR/psql-calls"
	PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO="$scenario" \
		PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO="$scenario" \
		IAM_PREREQUISITE_SQL="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql" \
		DATABASE_URL=postgresql://migration.example.test/opencrane OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
		OPENCRANE_MIGRATION_SILO_ID=test-silo OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test "$ENTRYPOINT"
}

run_scenario success
grep -q -- '--dbname postgresql://migration.example.test/opencrane' "$TEST_DIR/psql-calls"
grep -q -- '--set source_baseline_sha256=5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f' "$TEST_DIR/psql-calls"
grep -Eq -- '--set migration_sql_sha256=[0-9a-f]{64}' "$TEST_DIR/psql-calls"
grep -q -- '--set migration_silo_id=test-silo' "$TEST_DIR/psql-calls"
grep -q -- '--set migration_oidc_issuer=https://issuer.example.test' "$TEST_DIR/psql-calls"
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_2_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
	'migrate deploy') "$TEST_DIR/calls"

run_scenario baseline-applied
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_2_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
	'migrate deploy') "$TEST_DIR/calls"

run_scenario cutover-missing
run_scenario cutover-complete

: >"$TEST_DIR/calls"
if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=cutover-resolve-fails \
	PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO=success \
	IAM_PREREQUISITE_SQL="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql" \
	DATABASE_URL=postgresql://migration.example.test/opencrane OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
	OPENCRANE_MIGRATION_SILO_ID=test-silo OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test "$ENTRYPOINT"; then
	echo "migrator ignored an unexpected failed-migration recovery error" >&2
	exit 1
fi
[[ "$(grep -c '^migrate deploy$' "$TEST_DIR/calls" || true)" == "0" ]]

: >"$TEST_DIR/calls"
if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=deploy-fails \
	PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO=success \
	IAM_PREREQUISITE_SQL="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql" \
	DATABASE_URL=postgresql://migration.example.test/opencrane OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
	OPENCRANE_MIGRATION_SILO_ID=test-silo OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test "$ENTRYPOINT"; then
	echo "migrator accepted a failed deployment" >&2
	exit 1
fi
[[ "$(grep -c '^migrate deploy$' "$TEST_DIR/calls")" == "1" ]]

if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=success \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3 "$ENTRYPOINT"; then
	echo "migrator accepted an unsupported source release" >&2
	exit 1
fi

: >"$TEST_DIR/calls"
if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=success \
	PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO=prerequisite-fails \
	IAM_PREREQUISITE_SQL="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql" \
	DATABASE_URL=postgresql://migration.example.test/opencrane OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
	OPENCRANE_MIGRATION_SILO_ID=test-silo OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test "$ENTRYPOINT"; then
	echo "migrator ignored a failed IAM prerequisite" >&2
	exit 1
fi
[[ ! -s "$TEST_DIR/calls" ]]

echo "OpenCrane Prisma migrator contract: PASS"
