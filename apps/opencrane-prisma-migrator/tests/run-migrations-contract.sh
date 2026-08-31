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
if [ "$DATABASE_URL" != "$EXPECTED_DATABASE_URL" ]; then
	echo "Prisma received an altered database URL." >&2
	exit 97
fi
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
	central-missing:"migrate resolve --rolled-back 20260829000000_central_authorization_authority")
		echo "Error: P3011" >&2
		exit 1
		;;
	central-complete:"migrate resolve --rolled-back 20260829000000_central_authorization_authority")
		echo "Error: P3012" >&2
		exit 1
		;;
	central-resolve-fails:"migrate resolve --rolled-back 20260829000000_central_authorization_authority")
		echo "unexpected central authorization recovery error" >&2
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
if [ "$PGHOST" != "migration.example.test" ] \
	|| [ "$PGPORT" != "5432" ] \
	|| [ "$PGUSER" != "migration-user" ] \
	|| [ "$PGPASSWORD" != "sensitive/password" ] \
	|| [ "$PGDATABASE" != "opencrane" ] \
	|| [ "$PGSSLMODE" != "disable" ] \
	|| [ -n "${DATABASE_URL:-}" ]; then
	echo "psql received the wrong application connection environment." >&2
	exit 98
fi
case "$*" in
	--no-psqlrc\ *) ;;
	*)
		echo "psql can still load an ambient startup file." >&2
		exit 99
		;;
esac
if [ "$PSQL_SCENARIO" = "prerequisite-fails" ] \
	&& printf '%s\n' "$*" | grep -q -- '--set source_baseline_sha256='; then
	exit 1
fi
MOCK
chmod +x "$TEST_DIR/psql"

DATABASE_URL_WITH_POOL_TUNING='postgresql://migration-user:sensitive%2Fpassword@migration.example.test/opencrane?pool_timeout=5&sslmode=disable&connection_limit=5'
MIGRATION_CONNECTION_ENV=(
	"DATABASE_URL=$DATABASE_URL_WITH_POOL_TUNING"
	"EXPECTED_DATABASE_URL=$DATABASE_URL_WITH_POOL_TUNING"
	"PGHOST=migration.example.test"
	"PGPORT=5432"
	"PGUSER=migration-user"
	"PGPASSWORD=sensitive/password"
	"PGDATABASE=opencrane"
	"PGSSLMODE=disable"
)

invoke_migrator()
{
	local prisma_scenario="$1"
	local psql_scenario="${2:-$prisma_scenario}"
	env "${MIGRATION_CONNECTION_ENV[@]}" \
		PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO="$prisma_scenario" \
		PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO="$psql_scenario" \
		UNTAGGED_CANDIDATE_REPAIR_SQL="$ROOT/apps/opencrane/prisma/migrations/untagged-0.9.3-candidate-forward-repair/migration.sql" \
		IAM_PREREQUISITE_SQL="$ROOT/apps/opencrane/prisma/migrations/0.9.0-to-0.10.0-prerequisite/migration.sql" \
		OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
		OPENCRANE_MIGRATION_SILO_ID=test-silo \
		OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test \
		"$ENTRYPOINT"
}

run_scenario()
{
	local scenario="$1"
	: >"$TEST_DIR/calls"
	: >"$TEST_DIR/psql-calls"
	: >"$TEST_DIR/scenario-output"
	invoke_migrator "$scenario" >"$TEST_DIR/scenario-output" 2>&1
}

assert_successful_call_order()
{
	diff -u <(printf '%s\n' \
		'migrate resolve --applied 20260826000000_0_9_2_baseline' \
		'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
		'migrate resolve --rolled-back 20260829000000_central_authorization_authority' \
		'migrate deploy') "$TEST_DIR/calls"
}

run_scenario success
! grep -Fq -- '--dbname' "$TEST_DIR/psql-calls"
! grep -Eq -- 'connection_limit|pool_timeout' "$TEST_DIR/psql-calls"
! grep -Fq -- 'sensitive/password' "$TEST_DIR/psql-calls"
! grep -Fq -- 'sensitive%2Fpassword' "$TEST_DIR/psql-calls"
grep -q -- '--set source_baseline_sha256=5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f' "$TEST_DIR/psql-calls"
grep -Eq -- '--set repair_sql_sha256=[0-9a-f]{64}' "$TEST_DIR/psql-calls"
grep -Eq -- '--set migration_sql_sha256=[0-9a-f]{64}' "$TEST_DIR/psql-calls"
grep -q -- '--set migration_silo_id=test-silo' "$TEST_DIR/psql-calls"
grep -q -- '--set migration_oidc_issuer=https://issuer.example.test' "$TEST_DIR/psql-calls"
assert_successful_call_order

run_scenario baseline-applied
assert_successful_call_order

run_scenario cutover-missing
assert_successful_call_order
run_scenario cutover-complete
assert_successful_call_order
run_scenario central-missing
assert_successful_call_order
run_scenario central-complete
assert_successful_call_order

: >"$TEST_DIR/calls"
: >"$TEST_DIR/psql-calls"
: >"$TEST_DIR/scenario-output"
if invoke_migrator cutover-resolve-fails >"$TEST_DIR/scenario-output" 2>&1; then
	echo "migrator ignored an unexpected failed-migration recovery error" >&2
	exit 1
fi
grep -Fq -- 'unexpected database error' "$TEST_DIR/scenario-output"
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_2_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover') "$TEST_DIR/calls"

: >"$TEST_DIR/calls"
: >"$TEST_DIR/psql-calls"
: >"$TEST_DIR/scenario-output"
if invoke_migrator central-resolve-fails >"$TEST_DIR/scenario-output" 2>&1; then
	echo "migrator ignored an unexpected central-authorization recovery error" >&2
	exit 1
fi
grep -Fq -- 'unexpected central authorization recovery error' "$TEST_DIR/scenario-output"
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_2_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
	'migrate resolve --rolled-back 20260829000000_central_authorization_authority') "$TEST_DIR/calls"

: >"$TEST_DIR/calls"
: >"$TEST_DIR/psql-calls"
if invoke_migrator deploy-fails; then
	echo "migrator accepted a failed deployment" >&2
	exit 1
fi
assert_successful_call_order

if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=success \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3 "$ENTRYPOINT"; then
	echo "migrator accepted an unsupported source release" >&2
	exit 1
fi

: >"$TEST_DIR/calls"
: >"$TEST_DIR/psql-calls"
if invoke_migrator success prerequisite-fails; then
	echo "migrator ignored a failed IAM prerequisite" >&2
	exit 1
fi
[[ ! -s "$TEST_DIR/calls" ]]
[[ "$(wc -l <"$TEST_DIR/psql-calls" | tr -d ' ')" == "2" ]]

: >"$TEST_DIR/calls"
: >"$TEST_DIR/psql-calls"
: >"$TEST_DIR/scenario-output"
if env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE \
	DATABASE_URL="$DATABASE_URL_WITH_POOL_TUNING" \
	PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=success \
	PSQL_CLI="$TEST_DIR/psql" PSQL_CALLS="$TEST_DIR/psql-calls" PSQL_SCENARIO=success \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 \
	OPENCRANE_MIGRATION_SILO_ID=test-silo \
	OPENCRANE_MIGRATION_OIDC_ISSUER=https://issuer.example.test \
	"$ENTRYPOINT" >"$TEST_DIR/scenario-output" 2>&1; then
	echo "migrator accepted a missing libpq connection" >&2
	exit 1
fi
grep -Fxq -- 'The database URL, libpq connection, migration silo, and OIDC issuer are required.' "$TEST_DIR/scenario-output"
[[ ! -s "$TEST_DIR/calls" ]]
[[ ! -s "$TEST_DIR/psql-calls" ]]

echo "OpenCrane Prisma migrator contract: PASS"
