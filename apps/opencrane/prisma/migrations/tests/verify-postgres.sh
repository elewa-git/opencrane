#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SOURCE_REF="${OPENCRANE_MIGRATION_SOURCE_REF:-0.7.0}"
POSTGRES_IMAGE="${OPENCRANE_MIGRATION_POSTGRES_IMAGE:-opencrane-postgres:migration-test}"
MIGRATION_RELEASE_VERSION="${OPENCRANE_MIGRATION_RELEASE_VERSION:-$(jq -r '.version' "$ROOT/package.json")}"
LEGACY_TRANSITION_ROOT="$ROOT/apps/opencrane/prisma/migrations/0.7.0-to-0.8.0"
ORGANIZATION_TRANSITION_ROOT="$ROOT/apps/opencrane/prisma/migrations/0.8.0-to-0.9.0"
CURRENT_BASELINE="$ROOT/apps/opencrane/prisma/bootstrap/target-baseline.sql"
CLASSIFIER="$ROOT/apps/_infra/deploy-k8s/platform/database-convergence-classifier.sh"
WORK_DIR="$(mktemp -d)"
MIGRATION_RELEASE_ROOT="$ROOT"
CONTAINER="opencrane-migration-$$-$RANDOM"

cleanup()
{
	docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT

PROTECTED_DIGEST="25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d"
ORGANIZATION_FRESH_PROTECTED_DIGEST="12505f3c15114bd2a407d0d4d2ef2befc3c8ec87acaa9787503cfbe4eba0032c"
TARGET_FRESH_PROTECTED_DIGEST="bd2dfd915b66514d4c7ad95328adb4629567634a47f1a1e37aee69f23d9a98ee"
LEGACY_MIGRATION_SQL_DIGEST="$(node -e 'process.stdout.write(require(process.argv[1]).sqlSha256)' "$LEGACY_TRANSITION_ROOT/manifest.json")"
ORGANIZATION_MIGRATION_SQL_DIGEST="$(node -e 'process.stdout.write(require(process.argv[1]).sqlSha256)' "$ORGANIZATION_TRANSITION_ROOT/manifest.json")"
IAM_CUTOVER_SILO_ID="legacy-silo"
IAM_CUTOVER_OIDC_ISSUER="https://identity.test.invalid"

# This test reads the current release from its working tree before the tag exists and reads older releases from their tags.
if [[ "$(jq -r '.version' "$ROOT/package.json")" != "$MIGRATION_RELEASE_VERSION" ]]; then
	MIGRATION_RELEASE_ROOT="$WORK_DIR/migration-release"
	mkdir -p "$MIGRATION_RELEASE_ROOT"
	git archive "$MIGRATION_RELEASE_VERSION" package.json releases apps/opencrane/prisma/migrations apps/opencrane/prisma/bootstrap/target-baseline.sql \
		| tar -x -C "$MIGRATION_RELEASE_ROOT"
fi
MIGRATION_FROM_RELEASE_VERSION="${OPENCRANE_MIGRATION_FROM_RELEASE_VERSION:-$(jq -r '.previousRepositoryVersion' "$MIGRATION_RELEASE_ROOT/releases/$MIGRATION_RELEASE_VERSION.json")}"
TRANSITION_RESOLVER="$ROOT/scripts/release-versioning/database-transition.mjs"
if [[ "$MIGRATION_RELEASE_VERSION" == "0.9.3" && "$MIGRATION_FROM_RELEASE_VERSION" == "0.9.2" ]]; then
	TRANSITION_RESOLVER="$ROOT/scripts/release-versioning/database-transition-0.9.3.mjs"
fi
DATABASE_TRANSITION="$(node "$TRANSITION_RESOLVER" "$MIGRATION_RELEASE_ROOT" "$MIGRATION_RELEASE_VERSION" "$MIGRATION_FROM_RELEASE_VERSION")"
TARGET_TRANSITION_ROOT="$(dirname "$(jq -r '.migration.sqlFile' <<<"$DATABASE_TRANSITION")")"
TARGET_MIGRATION_SQL_DIGEST="$(jq -r '.migration.sqlSha256' <<<"$DATABASE_TRANSITION")"

git cat-file -e "$SOURCE_REF:apps/opencrane/prisma/bootstrap/target-baseline.sql"
git show "$SOURCE_REF:apps/opencrane/prisma/bootstrap/target-baseline.sql" >"$WORK_DIR/source-baseline.sql"
git cat-file -e "$MIGRATION_FROM_RELEASE_VERSION:apps/opencrane/prisma/bootstrap/target-baseline.sql"
git show "$MIGRATION_FROM_RELEASE_VERSION:apps/opencrane/prisma/bootstrap/target-baseline.sql" >"$WORK_DIR/0.9.0-baseline.sql"

docker run --detach --name "$CONTAINER" \
	--user root \
	--env POSTGRES_PASSWORD=opencrane-migration-test \
	"$POSTGRES_IMAGE" \
	-c shared_preload_libraries=pg_cron >/dev/null

wait_for_postgres()
{
	postgres_accepts_queries()
	{
		docker exec "$CONTAINER" psql --username postgres --dbname postgres \
			--tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx '1'
	}
	for _ in {1..60}; do
		# After `docker restart`, pg_isready can succeed even though the next SQL connection reports shutdown.
		# Require two SQL queries one second apart before the migration suite continues.
		if postgres_accepts_queries; then
			sleep 1
			if postgres_accepts_queries; then return; fi
		fi
		sleep 1
	done
	docker logs "$CONTAINER" >&2
	return 1
}

wait_for_postgres

psql_command()
{
	local database="$1"
	shift
	docker exec --interactive "$CONTAINER" psql --username postgres --dbname "$database" -v ON_ERROR_STOP=1 "$@"
}

configure_pg_cron_database()
{
	local database="$1"
	psql_command postgres --command "ALTER SYSTEM SET cron.database_name = '$database';" >/dev/null
	docker restart "$CONTAINER" >/dev/null
	wait_for_postgres
	psql_command "$database" --command 'CREATE EXTENSION pg_cron;' >/dev/null
}

source "$CLASSIFIER"
NAMESPACE=opencrane-migration-test
POSTGRES_RELEASE=opencrane-migration-test-postgres
TIMEOUT=30
POSTGRES_BASELINE_SHA256="$(jq -r '.targetBaselineSha256' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_TARGET_BASELINE_SHA256="$(jq -r '.migration.sourceTargetBaselineSha256' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON="$(jq -c '.migration.sourceProtectedBaselineSha256s' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256="$(jq -r '.migration.freshSourceProtectedBaselineSha256' <<<"$DATABASE_TRANSITION")"
[[ "$DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256" == "$TARGET_FRESH_PROTECTED_DIGEST" ]]
DATABASE_SOURCE_HISTORY_LINEAGES_JSON="$(jq -c '.migration.sourceHistoryLineages' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_MIGRATION_ID="$(jq -r '.migration.id' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_SCHEMA_VERSION="$(jq -r '.migration.fromSchemaVersion' <<<"$DATABASE_TRANSITION")"
DATABASE_TARGET_SCHEMA_VERSION="$(jq -r '.migration.toSchemaVersion' <<<"$DATABASE_TRANSITION")"
DATABASE_TARGET_BASELINE_SHA256="$(jq -r '.targetBaselineSha256' <<<"$DATABASE_TRANSITION")"
DATABASE_PREVIOUS_MIGRATION_SQL_SHA256="$(jq -r '.migration.sqlSha256' <<<"$DATABASE_TRANSITION")"
CLASSIFIER_DATABASE=""

kubectl()
{
	local argument
	local database_argument=false
	local -a psql_arguments=(--username postgres)
	if [[ " $* " == *" get pods "* ]]; then
		printf '%s\n' '{"items":[{"metadata":{"name":"opencrane-migration-test-postgres-1"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}'
		return
	fi
	if [[ " $* " != *" exec "* ]]; then
		return 1
	fi
	while (( $# > 0 )) && [[ "$1" != "psql" ]]; do
		shift
	done
	(( $# > 0 )) || return 1
	shift
	for argument in "$@"; do
		if [[ "$database_argument" == "true" ]]; then
			psql_arguments+=("$CLASSIFIER_DATABASE")
			database_argument=false
		elif [[ "$argument" == "--dbname" ]]; then
			psql_arguments+=("$argument")
			database_argument=true
		else
			psql_arguments+=("$argument")
		fi
	done
	docker exec --interactive "$CONTAINER" psql "${psql_arguments[@]}"
}

assert_classifier_state()
{
	local database="$1"
	local expected="$2"
	local actual
	CLASSIFIER_DATABASE="$database"
	actual="$(classify_live_database_convergence)"
	if [[ "$actual" != "$expected" ]]; then
		printf "classifier returned '%s' for '%s'; expected '%s'\n" "$actual" "$database" "$expected" >&2
		exit 1
	fi
}

clone_database()
{
	local source_database="$1"
	local target_database="$2"
	psql_command postgres --command "ALTER DATABASE \"$source_database\" WITH ALLOW_CONNECTIONS false;" >/dev/null
	psql_command postgres --command \
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$source_database' AND pid <> pg_backend_pid();" >/dev/null
	if ! psql_command postgres --command "CREATE DATABASE \"$target_database\" TEMPLATE \"$source_database\";" >/dev/null; then
		psql_command postgres --command "ALTER DATABASE \"$source_database\" WITH ALLOW_CONNECTIONS true;" >/dev/null
		return 1
	fi
	psql_command postgres --command "ALTER DATABASE \"$source_database\" WITH ALLOW_CONNECTIONS true;" >/dev/null
}

create_source_database()
{
	local database="$1"
	local protected_digest="${2:-$PROTECTED_DIGEST}"
	local baseline_file="${3:-$WORK_DIR/source-baseline.sql}"
	psql_command postgres --command "CREATE DATABASE \"$database\";" >/dev/null
	psql_command "$database" <<SQL
CREATE SCHEMA "opencrane_bootstrap";
CREATE TABLE "opencrane_bootstrap"."target_baseline" (
    "singleton" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("singleton"),
    "baseline_sha256" TEXT NOT NULL CHECK ("baseline_sha256" ~ '^[0-9a-f]{64}$')
);
INSERT INTO "opencrane_bootstrap"."target_baseline" ("singleton", "baseline_sha256")
VALUES (TRUE, '$protected_digest');
SQL
	psql_command "$database" <"$baseline_file" >/dev/null
}

seed_iam_cutover_fixture()
{
	local database="$1"
	psql_command "$database" <<SQL >/dev/null
INSERT INTO "org_memberships" (
    "id", "cluster_tenant", "subject", "email", "display_name", "role", "status", "created_at", "updated_at"
) VALUES (
    'principal-continuity', '$IAM_CUTOVER_SILO_ID', 'legacy-subject', 'legacy@example.com',
    'Legacy User', 'member', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);
INSERT INTO "artifacts" (
    "id", "silo_id", "owner_principal_id", "kind", "state", "retention_policy", "created_at", "updated_at"
) VALUES (
    'artifact-principal-continuity', '$IAM_CUTOVER_SILO_ID', 'legacy-subject', 'upload', 'active',
    'until_authorized_deletion', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);
INSERT INTO "mcp_servers" (
    "id", "name", "description", "endpoint", "scope", "transport", "status", "updated_at"
) VALUES (
    'mcp-principal-continuity', 'Principal continuity', '', 'https://mcp.test.invalid',
    'org', 'streamable-http', 'active', '2026-01-01T00:00:00.000Z'
);
INSERT INTO "mcp_server_installs" (
    "id", "mcp_server_id", "user_id", "connection_status", "created_at", "updated_at"
) VALUES (
    'mcp-install-principal-continuity', 'mcp-principal-continuity', 'legacy@example.com',
    'needs-credential', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);
SQL
}

assert_concurrent_group_cycle_rejected()
{
	local database="$1"
	local first_status
	local second_status
	psql_command "$database" --command \
		"INSERT INTO \"groups\" (\"id\", \"silo_id\", \"name\", \"membership_authority\", \"updated_at\") VALUES ('concurrent-a', '$IAM_CUTOVER_SILO_ID', 'Concurrent A', 'local', clock_timestamp()), ('concurrent-b', '$IAM_CUTOVER_SILO_ID', 'Concurrent B', 'local', clock_timestamp());" >/dev/null
	set +e
	psql_command "$database" --command \
		"BEGIN; UPDATE \"groups\" SET \"parent_id\" = 'concurrent-b' WHERE \"id\" = 'concurrent-a'; SELECT pg_sleep(1); COMMIT;" \
		>"$WORK_DIR/concurrent-a.log" 2>&1 &
	local first_pid=$!
	sleep 0.2
	psql_command "$database" --command \
		"BEGIN; UPDATE \"groups\" SET \"parent_id\" = 'concurrent-a' WHERE \"id\" = 'concurrent-b'; COMMIT;" \
		>"$WORK_DIR/concurrent-b.log" 2>&1
	second_status=$?
	wait "$first_pid"
	first_status=$?
	set -e
	if (( (first_status == 0) == (second_status == 0) )); then
		printf 'concurrent group cycle must accept exactly one transaction: first=%s second=%s\n' "$first_status" "$second_status" >&2
		exit 1
	fi
	awk '/group hierarchy cannot contain a cycle/{found=1} END{exit !found}' \
		"$WORK_DIR/concurrent-a.log" "$WORK_DIR/concurrent-b.log"
	psql_command "$database" --command \
		"UPDATE \"groups\" SET \"parent_id\" = NULL WHERE \"id\" IN ('concurrent-a', 'concurrent-b'); SET CONSTRAINTS groups_hierarchy_guard IMMEDIATE; DELETE FROM \"groups\" WHERE \"id\" IN ('concurrent-a', 'concurrent-b');" >/dev/null
}

create_source_database migrated
configure_pg_cron_database migrated
psql_command migrated <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "channel_runtime_routes" (
    "id", "silo_id", "agent_service_id", "action", "endpoint", "registered_at", "expires_at"
) VALUES
    ('legacy-event-route-a', 'legacy-silo', 'legacy-service-a', 'events.read', 'http://legacy-a.svc.cluster.local/events', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z'),
    ('legacy-event-route-b', 'legacy-silo', 'legacy-service-b', 'events.read', 'http://legacy-b.svc.cluster.local/events', '2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z');
INSERT INTO "tool_invocations" (
    "id", "silo_id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "subject_id",
    "tool_revision_id", "tool_invocation_id", "arguments_digest", "request_fingerprint"
) VALUES (
    'legacy-tool-invocation', 'legacy-silo', 'legacy-run', 1, 'legacy-service', 'legacy-revision', 'legacy-user',
    'legacy:tool:revision', 'legacy-tool-call', 'sha256:' || repeat('6', 64), 'sha256:' || repeat('7', 64)
);
INSERT INTO "runtime_external_action_retries" (
    "run_id", "attempt", "candidate_id", "retry_deadline_at", "updated_at"
) VALUES ('legacy-run', 1, 'legacy-candidate', clock_timestamp() + interval '5 minutes', clock_timestamp());
SET session_replication_role = origin;
SQL
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >/dev/null
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/retry-output.log"
grep -q 'already applied with exact history' "$WORK_DIR/retry-output.log"
clone_database migrated fresh_source
psql_command fresh_source <<SQL >/dev/null
DROP SCHEMA "opencrane_migrations" CASCADE;
UPDATE "opencrane_bootstrap"."target_baseline"
SET "baseline_sha256" = '$ORGANIZATION_FRESH_PROTECTED_DIGEST'
WHERE "singleton" = TRUE;
SQL
psql_command fresh_source --set "source_baseline_sha256=$ORGANIZATION_FRESH_PROTECTED_DIGEST" --set "migration_sql_sha256=$ORGANIZATION_MIGRATION_SQL_DIGEST" \
	--file - <"$ORGANIZATION_TRANSITION_ROOT/migration.sql" >/dev/null
assert_classifier_state fresh_source "source|$ORGANIZATION_FRESH_PROTECTED_DIGEST"
seed_iam_cutover_fixture fresh_source
psql_command fresh_source --set "source_baseline_sha256=$ORGANIZATION_FRESH_PROTECTED_DIGEST" --set "migration_sql_sha256=$TARGET_MIGRATION_SQL_DIGEST" --set "migration_silo_id=$IAM_CUTOVER_SILO_ID" --set "migration_oidc_issuer=$IAM_CUTOVER_OIDC_ISSUER" \
	--file - <"$TARGET_TRANSITION_ROOT/migration.sql" >/dev/null
assert_classifier_state fresh_source "completed|$ORGANIZATION_FRESH_PROTECTED_DIGEST"
psql_command fresh_source --tuples-only --no-align --command \
	'SELECT count(*) FROM "opencrane_migrations"."schema_history" WHERE "schema_version" = '\''0.9.0'\'' AND "source_schema_version" = '\''0.8.0'\'' AND "source_baseline_sha256" = '\''12505f3c15114bd2a407d0d4d2ef2befc3c8ec87acaa9787503cfbe4eba0032c'\'';' \
	| grep -qx '1'
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$ORGANIZATION_MIGRATION_SQL_DIGEST" \
	--file - <"$ORGANIZATION_TRANSITION_ROOT/migration.sql" >/dev/null
assert_classifier_state migrated "source|$PROTECTED_DIGEST"
seed_iam_cutover_fixture migrated
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$TARGET_MIGRATION_SQL_DIGEST" --set "migration_silo_id=$IAM_CUTOVER_SILO_ID" --set "migration_oidc_issuer=$IAM_CUTOVER_OIDC_ISSUER" \
	--file - <"$TARGET_TRANSITION_ROOT/migration.sql" >/dev/null
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$TARGET_MIGRATION_SQL_DIGEST" --set "migration_silo_id=$IAM_CUTOVER_SILO_ID" --set "migration_oidc_issuer=$IAM_CUTOVER_OIDC_ISSUER" \
	--file - <"$TARGET_TRANSITION_ROOT/migration.sql" >/dev/null
assert_classifier_state migrated "completed|$PROTECTED_DIGEST"

create_source_database fresh_090 "$TARGET_FRESH_PROTECTED_DIGEST" "$WORK_DIR/0.9.0-baseline.sql"
configure_pg_cron_database fresh_090
assert_classifier_state fresh_090 "source|$TARGET_FRESH_PROTECTED_DIGEST"
seed_iam_cutover_fixture fresh_090
psql_command fresh_090 --set "source_baseline_sha256=$TARGET_FRESH_PROTECTED_DIGEST" --set "migration_sql_sha256=$TARGET_MIGRATION_SQL_DIGEST" --set "migration_silo_id=$IAM_CUTOVER_SILO_ID" --set "migration_oidc_issuer=$IAM_CUTOVER_OIDC_ISSUER" \
	--file - <"$TARGET_TRANSITION_ROOT/migration.sql" >/dev/null
assert_classifier_state fresh_090 "completed|$TARGET_FRESH_PROTECTED_DIGEST"

clone_database migrated corrupt_migration_id
psql_command corrupt_migration_id --command \
	"UPDATE \"opencrane_migrations\".\"schema_history\" SET \"migration_id\" = 'corrupt-legacy-id' WHERE \"schema_version\" = '0.8.0';" >/dev/null
assert_classifier_state corrupt_migration_id "incompatible|$PROTECTED_DIGEST"

clone_database migrated corrupt_sql_digest
psql_command corrupt_sql_digest --command \
	"UPDATE \"opencrane_migrations\".\"schema_history\" SET \"sql_sha256\" = repeat('a', 64) WHERE \"schema_version\" = '0.8.0';" >/dev/null
assert_classifier_state corrupt_sql_digest "incompatible|$PROTECTED_DIGEST"

clone_database migrated corrupt_source_digest
psql_command corrupt_source_digest --command \
	"UPDATE \"opencrane_migrations\".\"schema_history\" SET \"source_baseline_sha256\" = '$DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256' WHERE \"schema_version\" = '0.8.0';" >/dev/null
assert_classifier_state corrupt_source_digest "incompatible|$PROTECTED_DIGEST"

clone_database migrated corrupt_source_version
psql_command corrupt_source_version --command \
	"UPDATE \"opencrane_migrations\".\"schema_history\" SET \"source_schema_version\" = '0.6.0' WHERE \"schema_version\" = '0.8.0';" >/dev/null
assert_classifier_state corrupt_source_version "incompatible|$PROTECTED_DIGEST"

clone_database migrated corrupt_history_order
psql_command corrupt_history_order --command \
	"UPDATE \"opencrane_migrations\".\"schema_history\" SET \"applied_at\" = clock_timestamp() + interval '1 day' WHERE \"schema_version\" = '0.8.0';" >/dev/null
assert_classifier_state corrupt_history_order "incompatible|$PROTECTED_DIGEST"

clone_database migrated extra_history_row
psql_command extra_history_row <<SQL >/dev/null
INSERT INTO "opencrane_migrations"."schema_history" (
    "schema_version", "source_schema_version", "source_baseline_sha256",
    "target_baseline_sha256", "sql_sha256", "migration_id"
) VALUES (
    '9.9.0', '9.8.0', '$PROTECTED_DIGEST', repeat('b', 64), repeat('c', 64), 'unadmitted-extra-transition'
);
SQL
assert_classifier_state extra_history_row "incompatible|$PROTECTED_DIGEST"

psql_command postgres --command 'CREATE DATABASE fresh;' >/dev/null
configure_pg_cron_database fresh
psql_command fresh <"$CURRENT_BASELINE" >/dev/null
psql_command fresh <"$ROOT/libs/backend/server/gateways/integrations/main/tests/integrations-authority.sql" >/dev/null

for database in migrated fresh_source fresh_090 fresh; do
	psql_command "$database" <"$ROOT/apps/opencrane/prisma/migrations/tests/tool-result-delivery-authority.sql" >/dev/null
	psql_command "$database" <"$ROOT/apps/opencrane/prisma/migrations/tests/conversation-activity-ordering.sql" >/dev/null
	psql_command "$database" <"$ROOT/apps/opencrane/prisma/migrations/tests/group-hierarchy-authority.sql" >/dev/null
	assert_concurrent_group_cycle_rejected "$database"
	docker exec "$CONTAINER" pg_dump --username postgres --dbname "$database" \
		--schema-only --no-owner --no-privileges \
		--exclude-schema cron --exclude-schema opencrane_bootstrap --exclude-schema opencrane_migrations \
		| sed -E '/^\\(un)?restrict /d' \
		| node "$ROOT/apps/opencrane/prisma/migrations/tests/normalize-schema-dump.mjs" \
		>"$WORK_DIR/$database-schema.sql"
done
for database in migrated fresh_source fresh_090; do
	diff --unified "$WORK_DIR/fresh-schema.sql" "$WORK_DIR/$database-schema.sql"
done

# The current release ships to silos in both shapes: bootstrapped fresh at the current baseline and
# migrated into that schema from an admitted origin. The lineage resolver must keep both deployable.
CURRENT_RELEASE_VERSION="$(jq -r '.version' "$ROOT/package.json")"
CURRENT_RELEASE_MANIFEST="$ROOT/releases/$CURRENT_RELEASE_VERSION.json"
SCHEMA_LINEAGE="$(node "$ROOT/scripts/release-versioning/schema-lineage.mjs" "$ROOT" "$CURRENT_RELEASE_VERSION")"
POSTGRES_BASELINE_SHA256="$(jq -r '.database.baselineSha256' "$CURRENT_RELEASE_MANIFEST")"
DATABASE_TARGET_BASELINE_SHA256="$POSTGRES_BASELINE_SHA256"
DATABASE_TARGET_SCHEMA_VERSION="$(jq -r '.database.schemaVersion' "$CURRENT_RELEASE_MANIFEST")"
DATABASE_PREVIOUS_MIGRATION_ID="$(jq -r '.id' <<<"$SCHEMA_LINEAGE")"
DATABASE_PREVIOUS_SCHEMA_VERSION="$(jq -r '.fromSchemaVersion' <<<"$SCHEMA_LINEAGE")"
DATABASE_PREVIOUS_TARGET_BASELINE_SHA256="$(jq -r '.sourceTargetBaselineSha256' <<<"$SCHEMA_LINEAGE")"
DATABASE_PREVIOUS_PROTECTED_BASELINE_SHA256S_JSON="$(jq -c '.sourceProtectedBaselineSha256s' <<<"$SCHEMA_LINEAGE")"
DATABASE_PREVIOUS_FRESH_PROTECTED_BASELINE_SHA256="$(jq -r '.freshSourceProtectedBaselineSha256' <<<"$SCHEMA_LINEAGE")"
DATABASE_SOURCE_HISTORY_LINEAGES_JSON="$(jq -c '.sourceHistoryLineages' <<<"$SCHEMA_LINEAGE")"
DATABASE_PREVIOUS_MIGRATION_SQL_SHA256="$(jq -r '.sqlSha256' <<<"$SCHEMA_LINEAGE")"
[[ "$DATABASE_TARGET_SCHEMA_VERSION" == "$(jq -r '.toSchemaVersion' <<<"$SCHEMA_LINEAGE")" ]]

# A fresh bootstrap records where the database was born and writes no migration history. The postgres
# chart's bootstrap Job owns this row in a real silo.
psql_command fresh <<SQL >/dev/null
CREATE SCHEMA "opencrane_bootstrap";
CREATE TABLE "opencrane_bootstrap"."target_baseline" (
    "singleton" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("singleton"),
    "baseline_sha256" TEXT NOT NULL CHECK ("baseline_sha256" ~ '^[0-9a-f]{64}$')
);
INSERT INTO "opencrane_bootstrap"."target_baseline" ("singleton", "baseline_sha256")
VALUES (TRUE, '$POSTGRES_BASELINE_SHA256');
SQL
assert_classifier_state fresh "current|$POSTGRES_BASELINE_SHA256"
assert_classifier_state fresh_source "completed|$ORGANIZATION_FRESH_PROTECTED_DIGEST"
assert_classifier_state fresh_090 "completed|$TARGET_FRESH_PROTECTED_DIGEST"
assert_classifier_state migrated "completed|$PROTECTED_DIGEST"

for database in fresh_source migrated fresh_090; do
	[[ "$(psql_command "$database" --tuples-only --no-align --command \
		' SELECT count(*) FROM "artifacts" WHERE "id" = '\''artifact-principal-continuity'\'' AND "owner_principal_id" = '\''principal-continuity'\'';')" == "1" ]]
	[[ "$(psql_command "$database" --tuples-only --no-align --command \
		' SELECT count(*) FROM "mcp_server_installs" WHERE "id" = '\''mcp-install-principal-continuity'\'' AND "principal_id" = '\''principal-continuity'\'';')" == "1" ]]
done

psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "persona_questions" WHERE "question_set_id" = '\''personal-agent-onboarding'\'' AND "question_set_version" = 1;' \
	| grep -qx '10'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "persona_scoring_weights" WHERE "scoring_policy_id" = '\''personal-agent-scoring'\'' AND "scoring_policy_version" = 1;' \
	| grep -qx '37'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "opencrane_migrations"."schema_history" WHERE "schema_version" = '\''0.8.0'\'' AND "source_schema_version" = '\''0.7.0'\'';' \
	| grep -qx '1'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "opencrane_migrations"."schema_history" WHERE "schema_version" = '\''0.9.0'\'' AND "source_schema_version" = '\''0.8.0'\'' AND "source_baseline_sha256" = '\''25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d'\'';' \
	| grep -qx '1'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "opencrane_migrations"."schema_history";' \
	| grep -qx '3'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "opencrane_migrations"."schema_history" WHERE "schema_version" = '\''0.9.3'\'' AND "source_schema_version" = '\''0.9.0'\'' AND "source_baseline_sha256" = '\''25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d'\'';' \
	| grep -qx '1'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "organization_invitations";' \
	| grep -qx '0'
psql_command migrated --tuples-only --no-align --command \
	"SELECT count(*) FROM \"channel_runtime_routes\" WHERE \"id\" IN ('legacy-event-route-a', 'legacy-event-route-b') AND \"receiver_id\" = 'legacy-route-v0:' || \"id\" AND \"is_current\" = FALSE AND \"legacy_expires_at\" IS NOT NULL AND \"revoked_at\" IS NOT NULL;" \
	| grep -qx '2'
psql_command migrated --tuples-only --no-align --command \
	"SELECT count(DISTINCT \"revoked_at\") FROM \"channel_runtime_routes\" WHERE \"id\" IN ('legacy-event-route-a', 'legacy-event-route-b');" \
	| grep -qx '1'
psql_command migrated --tuples-only --no-align --command \
	"SELECT count(*) FROM \"channel_runtime_routes\" WHERE (\"id\" = 'legacy-event-route-a' AND \"endpoint\" = 'http://legacy-a.svc.cluster.local/events' AND \"registered_at\" = '2026-01-01T00:00:00.000Z') OR (\"id\" = 'legacy-event-route-b' AND \"endpoint\" = 'http://legacy-b.svc.cluster.local/events' AND \"registered_at\" = '2026-01-02T00:00:00.000Z');" \
	| grep -qx '2'
psql_command migrated --tuples-only --no-align --command \
	"SELECT count(*) FROM \"channel_runtime_routes\" WHERE (\"id\" = 'legacy-event-route-a' AND \"legacy_expires_at\" = '2026-01-01T01:00:00.000Z') OR (\"id\" = 'legacy-event-route-b' AND \"legacy_expires_at\" = '2026-01-02T01:00:00.000Z');" \
	| grep -qx '2'
psql_command migrated --tuples-only --no-align --command \
	'SELECT count(*) FROM "tool_invocations" WHERE "id" = '\''legacy-tool-invocation'\'';' \
	| grep -qx '0'
psql_command migrated --tuples-only --no-align --command \
	"SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'runtime_external_action_retries';" \
	| grep -qx '0'
if psql_command migrated --command \
	"UPDATE \"channel_runtime_routes\" SET \"endpoint\" = 'http://mutated.svc.cluster.local/events' WHERE \"id\" = 'legacy-event-route-a';" \
	>"$WORK_DIR/legacy-route-update-output.log" 2>&1; then
	echo "migrated legacy route evidence unexpectedly allowed mutation" >&2
	exit 1
fi
grep -q 'legacy ChannelRuntimeRoute evidence is immutable' "$WORK_DIR/legacy-route-update-output.log"

create_source_database populated
psql_command populated --command \
	'INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES ('\''profile-legacy'\'', '\''silo-legacy'\'', '\''user-legacy'\'', clock_timestamp());' \
	>/dev/null
if psql_command populated --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-output.log" 2>&1; then
	echo "populated 0.7 persona fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC708' "$WORK_DIR/populated-output.log"
psql_command populated --tuples-only --no-align --command \
	'SELECT count(*) FROM "persona_profiles" WHERE "id" = '\''profile-legacy'\'';' \
	| grep -qx '1'
psql_command populated --tuples-only --no-align --command \
	"SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'persona_interview_answers' AND column_name = 'value';" \
	| grep -qx '1'
psql_command populated --tuples-only --no-align --command \
	"SELECT count(*) FROM pg_type WHERE typname = 'PersonaColour';" \
	| grep -qx '0'

create_source_database populated_conversation
psql_command populated_conversation <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('conversation-legacy', 'silo-legacy', 'agent-service-legacy', clock_timestamp());
SET session_replication_role = origin;
SQL
if psql_command populated_conversation --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-conversation-output.log" 2>&1; then
	echo "populated 0.7 Conversation fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC710' "$WORK_DIR/populated-conversation-output.log"
psql_command populated_conversation --tuples-only --no-align --command \
	'SELECT count(*) FROM "conversation_threads" WHERE "id" = '\''conversation-legacy'\'';' \
	| grep -qx '1'
psql_command populated_conversation --tuples-only --no-align --command \
	"SELECT count(*) FROM pg_type WHERE typname = 'ConversationMode';" \
	| grep -qx '0'

create_source_database populated_invocation_context
psql_command populated_invocation_context <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "channel_invocation_contexts" (
    "id", "digest", "subject_id", "silo_id", "thread_id", "agent_service_id", "action",
    "route_id", "membership_revision", "authorization_digest", "expires_at"
) VALUES (
    'legacy-context', 'sha256:' || repeat('4', 64), 'legacy-user', 'legacy-silo', 'legacy-thread',
    'legacy-service', 'events.read', 'legacy-route', 1, 'sha256:' || repeat('5', 64),
    clock_timestamp() + interval '1 hour'
);
SET session_replication_role = origin;
SQL
if psql_command populated_invocation_context --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-context-output.log" 2>&1; then
	echo "populated 0.7 invocation context fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC710' "$WORK_DIR/populated-context-output.log"
grep -q 'legacy_invocation_contexts' "$WORK_DIR/populated-context-output.log"
psql_command populated_invocation_context --tuples-only --no-align --command \
	'SELECT count(*) FROM "channel_invocation_contexts" WHERE "id" = '\''legacy-context'\'';' \
	| grep -qx '1'

create_source_database populated_approval
psql_command populated_approval <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
    "approver_policy_revision", "effective_policy_digest", "expires_at"
) VALUES (
    'legacy-approval', 'legacy-run', 1, 'legacy-revision', 'legacy-service', 'legacy-silo',
    'legacy-proof', repeat('k', 43), 'legacy-user', 'legacy-runtime',
    'legacy-runtime', 'legacy-namespace', 'job', 'legacy-workload', 'legacy-pod',
    'message', 'legacy-message', 'send', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
    'legacy-policy', 'sha256:' || repeat('3', 64), clock_timestamp() + interval '1 hour'
);
SET session_replication_role = origin;
SQL
if psql_command populated_approval --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-approval-output.log" 2>&1; then
	echo "populated 0.7 approval fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC711' "$WORK_DIR/populated-approval-output.log"
psql_command populated_approval --tuples-only --no-align --command \
	'SELECT count(*) FROM "approval_requests" WHERE "id" = '\''legacy-approval'\'';' \
	| grep -qx '1'

create_source_database populated_integration_assignment
psql_command populated_integration_assignment <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "agent_revision_integration_assignments" (
    "agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools"
) VALUES ('legacy-revision', 'legacy-integration', 'legacy-silo', 'legacy-custody', ARRAY['calendar.read']);
SET session_replication_role = origin;
SQL
if psql_command populated_integration_assignment --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$LEGACY_MIGRATION_SQL_DIGEST" \
	--file - <"$LEGACY_TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-integration-output.log" 2>&1; then
	echo "populated 0.7 integration assignment fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC712' "$WORK_DIR/populated-integration-output.log"
psql_command populated_integration_assignment --tuples-only --no-align --command \
	'SELECT count(*) FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = '\''legacy-revision'\'';' \
	| grep -qx '1'

echo "0.7.0-to-0.8.0-to-0.9.0-to-0.9.3 PostgreSQL migration convergence: PASS"
