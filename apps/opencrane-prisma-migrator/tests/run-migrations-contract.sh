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
	baseline-applied:"migrate resolve --applied 20260826000000_0_9_3_baseline")
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

run_scenario()
{
	local scenario="$1"
	: >"$TEST_DIR/calls"
	PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO="$scenario" \
		OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3 "$ENTRYPOINT"
}

run_scenario success
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_3_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
	'migrate deploy') "$TEST_DIR/calls"

run_scenario baseline-applied
diff -u <(printf '%s\n' \
	'migrate resolve --applied 20260826000000_0_9_3_baseline' \
	'migrate resolve --rolled-back 20260827000000_0_10_0_workflow_cutover' \
	'migrate deploy') "$TEST_DIR/calls"

run_scenario cutover-missing
run_scenario cutover-complete

: >"$TEST_DIR/calls"
if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=cutover-resolve-fails \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3 "$ENTRYPOINT"; then
	echo "migrator ignored an unexpected failed-migration recovery error" >&2
	exit 1
fi
[[ "$(grep -c '^migrate deploy$' "$TEST_DIR/calls" || true)" == "0" ]]

: >"$TEST_DIR/calls"
if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=deploy-fails \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3 "$ENTRYPOINT"; then
	echo "migrator accepted a failed deployment" >&2
	exit 1
fi
[[ "$(grep -c '^migrate deploy$' "$TEST_DIR/calls")" == "1" ]]

if PRISMA_CLI="$TEST_DIR/prisma" PRISMA_CALLS="$TEST_DIR/calls" PRISMA_SCENARIO=success \
	OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2 "$ENTRYPOINT"; then
	echo "migrator accepted an unsupported source release" >&2
	exit 1
fi

echo "OpenCrane Prisma migrator contract: PASS"
