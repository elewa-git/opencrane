#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SOURCE_REF="${OPENCRANE_MIGRATION_SOURCE_REF:-0.7.0}"
POSTGRES_IMAGE="${OPENCRANE_MIGRATION_POSTGRES_IMAGE:-postgres:17.5}"
TRANSITION_ROOT="$ROOT/apps/opencrane/prisma/migrations/0.7.0-to-0.8.0"
CURRENT_BASELINE="$ROOT/apps/opencrane/prisma/bootstrap/target-baseline.sql"
WORK_DIR="$(mktemp -d)"
CONTAINER="opencrane-migration-$$-$RANDOM"
PROTECTED_DIGEST="25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d"
MIGRATION_SQL_DIGEST="$(node -e 'process.stdout.write(require(process.argv[1]).sqlSha256)' "$TRANSITION_ROOT/manifest.json")"

cleanup()
{
	docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT

git cat-file -e "$SOURCE_REF:apps/opencrane/prisma/bootstrap/target-baseline.sql"
git show "$SOURCE_REF:apps/opencrane/prisma/bootstrap/target-baseline.sql" >"$WORK_DIR/source-baseline.sql"

docker run --detach --name "$CONTAINER" \
	--env POSTGRES_PASSWORD=opencrane-migration-test \
	"$POSTGRES_IMAGE" >/dev/null

for _ in {1..60}; do
	if docker exec "$CONTAINER" pg_isready --username postgres >/dev/null 2>&1; then break; fi
	sleep 1
done
docker exec "$CONTAINER" pg_isready --username postgres >/dev/null

psql_command()
{
	local database="$1"
	shift
	docker exec --interactive "$CONTAINER" psql --username postgres --dbname "$database" -v ON_ERROR_STOP=1 "$@"
}

create_source_database()
{
	local database="$1"
	psql_command postgres --command "CREATE DATABASE \"$database\";" >/dev/null
	psql_command "$database" <<SQL
CREATE SCHEMA "opencrane_bootstrap";
CREATE TABLE "opencrane_bootstrap"."target_baseline" (
    "singleton" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("singleton"),
    "baseline_sha256" TEXT NOT NULL CHECK ("baseline_sha256" ~ '^[0-9a-f]{64}$')
);
INSERT INTO "opencrane_bootstrap"."target_baseline" ("singleton", "baseline_sha256")
VALUES (TRUE, '$PROTECTED_DIGEST');
SQL
	psql_command "$database" <"$WORK_DIR/source-baseline.sql" >/dev/null
}

create_source_database migrated
psql_command migrated <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO "channel_runtime_routes" (
    "id", "silo_id", "agent_service_id", "action", "endpoint", "registered_at", "expires_at"
) VALUES
    ('legacy-event-route-a', 'legacy-silo', 'legacy-service-a', 'events.read', 'http://legacy-a.svc.cluster.local/events', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z'),
    ('legacy-event-route-b', 'legacy-silo', 'legacy-service-b', 'events.read', 'http://legacy-b.svc.cluster.local/events', '2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z');
SET session_replication_role = origin;
SQL
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >/dev/null
psql_command migrated --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/retry-output.log"
grep -q 'already applied with exact history' "$WORK_DIR/retry-output.log"

psql_command postgres --command 'CREATE DATABASE fresh;' >/dev/null
psql_command fresh <"$CURRENT_BASELINE" >/dev/null
psql_command fresh <"$ROOT/libs/backend/server/gateways/integrations/main/tests/integrations-authority.sql" >/dev/null

for database in migrated fresh; do
	psql_command "$database" <"$ROOT/apps/opencrane/prisma/migrations/tests/conversation-activity-ordering.sql" >/dev/null
	docker exec "$CONTAINER" pg_dump --username postgres --dbname "$database" \
		--schema-only --no-owner --no-privileges \
		--exclude-schema opencrane_bootstrap --exclude-schema opencrane_migrations \
		| sed -E '/^\\(un)?restrict /d' \
		| node "$ROOT/apps/opencrane/prisma/migrations/tests/normalize-schema-dump.mjs" \
		>"$WORK_DIR/$database-schema.sql"
done
diff --unified "$WORK_DIR/fresh-schema.sql" "$WORK_DIR/migrated-schema.sql"

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
if psql_command populated --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-output.log" 2>&1; then
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
if psql_command populated_conversation --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-conversation-output.log" 2>&1; then
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
if psql_command populated_invocation_context --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-context-output.log" 2>&1; then
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
if psql_command populated_approval --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-approval-output.log" 2>&1; then
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
if psql_command populated_integration_assignment --set VERBOSITY=verbose --set "source_baseline_sha256=$PROTECTED_DIGEST" --set "migration_sql_sha256=$MIGRATION_SQL_DIGEST" \
	--file - <"$TRANSITION_ROOT/migration.sql" >"$WORK_DIR/populated-integration-output.log" 2>&1; then
	echo "populated 0.7 integration assignment fixture unexpectedly migrated" >&2
	exit 1
fi
grep -q 'OC712' "$WORK_DIR/populated-integration-output.log"
psql_command populated_integration_assignment --tuples-only --no-align --command \
	'SELECT count(*) FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = '\''legacy-revision'\'';' \
	| grep -qx '1'

echo "0.7.0-to-0.8.0 PostgreSQL migration: PASS"
