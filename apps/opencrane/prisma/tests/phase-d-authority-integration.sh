#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_FILE="$SCRIPT_DIR/phase-d-authority-integration.sql"

if command -v psql >/dev/null 2>&1; then
  : "${DATABASE_URL:?Set DATABASE_URL to an empty database with the target baseline applied}"
  run_psql() {
    psql "$DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
  }
else
  : "${POSTGRES_CONTAINER:?Set POSTGRES_CONTAINER when psql is not installed locally}"

  run_psql() {
    docker exec --interactive "$POSTGRES_CONTAINER" \
      psql \
      --username="${POSTGRES_USER:-postgres}" \
      --dbname="${POSTGRES_DB:-opencrane}" \
      --no-psqlrc \
      --set=ON_ERROR_STOP=1 \
      "$@"
  }
fi

run_psql < "$SCRIPT_DIR/authorization-active-grant-uniqueness.sql"
run_psql < "$TEST_FILE"
run_psql < "$SCRIPT_DIR/run-input-snapshot-admission.sql"
run_psql < "$SCRIPT_DIR/skill-authoring-validation-authority.sql"

RACE_DIR="$(mktemp -d)"
trap 'rm -rf "$RACE_DIR"' EXIT

wait_for_blocked_session() {
  local application_name="$1"
  local blocked
  local attempt
  for attempt in $(seq 1 40); do
    blocked="$(run_psql --tuples-only --no-align --command="
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = '$application_name'
          AND cardinality(pg_blocking_pids(pid)) > 0
      );
    ")"
    if [[ "$blocked" == "t" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL: $application_name was not observed waiting on an authority row lock" >&2
  return 1
}

wait_for_holder_sleeping() {
  local application_name="$1"
  local ready
  local attempt
  for attempt in $(seq 1 40); do
    ready="$(run_psql --tuples-only --no-align --command="
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = '$application_name'
          AND state = 'active'
          AND wait_event_type = 'Timeout'
          AND wait_event = 'PgSleep'
      );
    ")"
    if [[ "$ready" == "t" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL: $application_name did not reach its post-lock hold point" >&2
  return 1
}

run_psql <<'SQL'
INSERT INTO "model_definitions" ("id", "silo_id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at") VALUES
  ('phase-d-model', 'silo-race', 'global', 'phase-d-model', 'litellm-phase-d-model', 'phase-d-model', clock_timestamp()),
  ('phase-d-cancel-proof-model', 'silo-race-cancel-proof', 'global', 'phase-d-cancel-proof-model', 'litellm-phase-d-cancel-proof-model', 'phase-d-cancel-proof-model', clock_timestamp());

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at") VALUES
  ('svc-race-assignment-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-assignment', 'internal', clock_timestamp()),
  ('svc-race-assignment-first-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-assignment-first', 'internal', clock_timestamp()),
  ('svc-race-activation-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-activation', 'internal', clock_timestamp()),
  ('svc-race-retirement-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-retirement', 'internal', clock_timestamp()),
  ('svc-race-run-rollover-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-run-rollover', 'internal', clock_timestamp()),
  ('svc-race-run-first-principal', 'silo-race', 'urn:opencrane:agent-service', 'svc-race-run-first', 'internal', clock_timestamp()),
  ('svc-race-action-authority-principal', 'silo-race-action', 'urn:opencrane:agent-service', 'svc-race-action-authority', 'internal', clock_timestamp()),
  ('svc-race-cancel-proof-principal', 'silo-race-cancel-proof', 'urn:opencrane:agent-service', 'svc-race-cancel-proof', 'internal', clock_timestamp());

SQL

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-assignment', 'silo-race', 'managed', 'Assignment race',
  'standard', 'svc-race-assignment-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by"
) VALUES (
  'rev-race-assignment', 'silo-race', 'svc-race-assignment', 1, 'draft', 'sha256:' || repeat('1', 64),
  'prompt-v1', 'phase-d-model', '{}', 'user-race'
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/publisher.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-revision-publisher';
BEGIN;
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'rev-race-assignment';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/publisher.status"
) &
publisher_pid=$!
wait_for_holder_sleeping 'phase-d-revision-publisher'
(
  set +e
  run_psql >"$RACE_DIR/assignment.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-assignment-insert';
INSERT INTO "agent_revision_skill_assignments" (
  "agent_revision_id", "skill_id", "skill_revision_id"
) VALUES ('rev-race-assignment', 'skill-race', 'skill-revision-race');
SQL
  echo "$?" >"$RACE_DIR/assignment.status"
) &
assignment_pid=$!
wait_for_blocked_session 'phase-d-assignment-insert'
wait "$publisher_pid"
wait "$assignment_pid"
if [[ "$(<"$RACE_DIR/publisher.status")" != "0" ]]; then
  cat "$RACE_DIR/publisher.out" >&2
  echo 'FAIL: concurrent revision publication failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/assignment.status")" == "0" ]] \
  || ! grep -q 'assignments may be added only to a draft AgentRevision' "$RACE_DIR/assignment.out"; then
  cat "$RACE_DIR/assignment.out" >&2
  echo 'FAIL: assignment insertion bypassed concurrent publication' >&2
  exit 1
fi
echo 'PASS: concurrent publication serializes and rejects a late revision assignment'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-assignment-first', 'silo-race', 'managed', 'Assignment first race',
  'standard', 'svc-race-assignment-first-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by"
) VALUES (
  'rev-race-assignment-first', 'silo-race', 'svc-race-assignment-first', 1, 'draft', 'sha256:' || repeat('6', 64),
  'prompt-v1', 'phase-d-model', '{}', 'user-race'
);
SQL

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO "skills" (
  "id", "silo_id", "owner_principal_id", "name", "updated_at"
) VALUES (
  'skill-race-first', 'silo-race', 'user-race', 'Assignment-first race skill', clock_timestamp()
);
INSERT INTO "skill_revisions" (
  "id", "skill_id", "revision", "state", "artifact_id", "artifact_revision_id",
  "artifact_content_address", "manifest", "requirements", "test_report", "scan_result",
  "trust_class", "signature", "signer_key_id", "authored_by", "reviewed_by", "published_at"
) VALUES (
  'skill-revision-race-first', 'skill-race-first', 1, 'published', 'artifact-race-first',
  'artifact-revision-race-first', 'sha256:' || repeat('c', 64), '{}', '{}', '{"passed":true}',
  '{"passed":true}', 'reviewed_instructions', 'signature-race-first', 'signer-race-first',
  'user-race', 'user-race-reviewer', clock_timestamp()
);
SET LOCAL session_replication_role = origin;
COMMIT;
SQL

(
  set +e
  run_psql >"$RACE_DIR/assignment-first.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-assignment-first';
BEGIN;
INSERT INTO "agent_revision_skill_assignments" (
  "agent_revision_id", "skill_id", "skill_revision_id"
) VALUES ('rev-race-assignment-first', 'skill-race-first', 'skill-revision-race-first');
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/assignment-first.status"
) &
assignment_first_pid=$!
wait_for_holder_sleeping 'phase-d-assignment-first'
(
  set +e
  run_psql >"$RACE_DIR/publish-second.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-publication-after-assignment';
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'rev-race-assignment-first';
SQL
  echo "$?" >"$RACE_DIR/publish-second.status"
) &
publish_second_pid=$!
wait_for_blocked_session 'phase-d-publication-after-assignment'
wait "$assignment_first_pid"
wait "$publish_second_pid"
if [[ "$(<"$RACE_DIR/assignment-first.status")" != "0" ]]; then
  cat "$RACE_DIR/assignment-first.out" >&2
  echo 'FAIL: pre-publication revision assignment failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/publish-second.status")" != "0" ]]; then
  cat "$RACE_DIR/publish-second.out" >&2
  echo 'FAIL: revision publication did not serialize after the assignment' >&2
  exit 1
fi
echo 'PASS: pre-publication assignment commits before serialized revision publication'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-activation', 'silo-race', 'managed', 'Activation race',
  'standard', 'svc-race-activation-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-activation', 'silo-race', 'svc-race-activation', 1, 'published', 'sha256:' || repeat('2', 64),
  'prompt-v1', 'phase-d-model', '{}', 'user-race', clock_timestamp()
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/activation.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-service-activation';
BEGIN;
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-activation'
WHERE "id" = 'svc-race-activation';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/activation.status"
) &
activation_pid=$!
wait_for_holder_sleeping 'phase-d-service-activation'
(
  set +e
  run_psql >"$RACE_DIR/retirement.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-revision-retirement';
UPDATE "agent_revisions" SET "state" = 'retired' WHERE "id" = 'rev-race-activation';
SQL
  echo "$?" >"$RACE_DIR/retirement.status"
) &
retirement_pid=$!
wait_for_blocked_session 'phase-d-revision-retirement'
wait "$activation_pid"
wait "$retirement_pid"
if [[ "$(<"$RACE_DIR/activation.status")" != "0" ]]; then
  cat "$RACE_DIR/activation.out" >&2
  echo 'FAIL: concurrent AgentService activation failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/retirement.status")" == "0" ]] \
  || ! grep -q 'active AgentService revision must remain Published' "$RACE_DIR/retirement.out"; then
  cat "$RACE_DIR/retirement.out" >&2
  echo 'FAIL: revision retirement bypassed concurrent AgentService activation' >&2
  exit 1
fi
echo 'PASS: concurrent activation serializes and rejects active revision retirement'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-retirement', 'silo-race', 'managed', 'Retirement race',
  'standard', 'svc-race-retirement-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-retirement', 'silo-race', 'svc-race-retirement', 1, 'published', 'sha256:' || repeat('3', 64),
  'prompt-v1', 'phase-d-model', '{}', 'user-race', clock_timestamp()
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/retire-first.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-retirement-first';
BEGIN;
UPDATE "agent_revisions" SET "state" = 'retired' WHERE "id" = 'rev-race-retirement';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/retire-first.status"
) &
retire_first_pid=$!
wait_for_holder_sleeping 'phase-d-retirement-first'
(
  set +e
  run_psql >"$RACE_DIR/activate-second.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-activation-after-retirement';
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-retirement'
WHERE "id" = 'svc-race-retirement';
SQL
  echo "$?" >"$RACE_DIR/activate-second.status"
) &
activate_second_pid=$!
wait_for_blocked_session 'phase-d-activation-after-retirement'
wait "$retire_first_pid"
wait "$activate_second_pid"
if [[ "$(<"$RACE_DIR/retire-first.status")" != "0" ]]; then
  cat "$RACE_DIR/retire-first.out" >&2
  echo 'FAIL: concurrent revision retirement failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/activate-second.status")" == "0" ]] \
  || ! grep -q 'must be a Published revision of the same service' "$RACE_DIR/activate-second.out"; then
  cat "$RACE_DIR/activate-second.out" >&2
  echo 'FAIL: AgentService activation bypassed concurrent revision retirement' >&2
  exit 1
fi
echo 'PASS: concurrent retirement serializes and rejects stale AgentService activation'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-run-rollover', 'silo-race', 'managed', 'Run rollover race',
  'standard', 'svc-race-run-rollover-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by", "published_at"
) VALUES
  ('rev-race-run-rollover-1', 'silo-race', 'svc-race-run-rollover', 1, 'published', 'sha256:' || repeat('7', 64),
   'prompt-v1', 'phase-d-model', '{}', 'user-race', clock_timestamp()),
  ('rev-race-run-rollover-2', 'silo-race', 'svc-race-run-rollover', 2, 'published', 'sha256:' || repeat('8', 64),
   'prompt-v1', 'phase-d-model', '{}', 'user-race', clock_timestamp());
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-run-rollover-1'
WHERE "id" = 'svc-race-run-rollover';
INSERT INTO "conversations" (
  "id", "silo_id", "agent_service_id", "mode", "updated_at"
) VALUES (
  'conversation-race-superseded', 'silo-race', 'svc-race-run-rollover', 'agent_session', clock_timestamp()
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/run-rollover.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-run-rollover';
BEGIN;
UPDATE "agent_services"
SET "active_revision_id" = 'rev-race-run-rollover-2'
WHERE "id" = 'svc-race-run-rollover';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/run-rollover.status"
) &
run_rollover_pid=$!
wait_for_holder_sleeping 'phase-d-run-rollover'
(
  set +e
  run_psql >"$RACE_DIR/run-after-rollover.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-run-after-rollover';
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-superseded', 'silo-race', 'svc-race-run-rollover', 'rev-race-run-rollover-1', 'conversation-race-superseded', 'interactive',
  'request-race-superseded', 'run-race-superseded', 'sha256:' || repeat('9', 64),
  'sha256:' || repeat('a', 64)
);
SQL
  echo "$?" >"$RACE_DIR/run-after-rollover.status"
) &
run_after_rollover_pid=$!
wait_for_blocked_session 'phase-d-run-after-rollover'
wait "$run_rollover_pid"
wait "$run_after_rollover_pid"
if [[ "$(<"$RACE_DIR/run-rollover.status")" != "0" ]]; then
  cat "$RACE_DIR/run-rollover.out" >&2
  echo 'FAIL: concurrent active revision rollover failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/run-after-rollover.status")" == "0" ]] \
  || ! grep -q 'requires the exact silo and active revision of an Active AgentService' "$RACE_DIR/run-after-rollover.out"; then
  cat "$RACE_DIR/run-after-rollover.out" >&2
  echo 'FAIL: AgentRun insertion bypassed concurrent active revision rollover' >&2
  exit 1
fi
echo 'PASS: concurrent rollover serializes and rejects a run on the superseded revision'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
  'svc-race-run-first', 'silo-race', 'managed', 'Run first race',
  'standard', 'svc-race-run-first-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-run-first', 'silo-race', 'svc-race-run-first', 1, 'published', 'sha256:' || repeat('b', 64),
  'prompt-v1', 'phase-d-model', '{}', 'user-race', clock_timestamp()
);
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-run-first'
WHERE "id" = 'svc-race-run-first';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('conversation-race-before-retirement', 'silo-race', 'svc-race-run-first', 'agent_session', clock_timestamp());
SQL

(
  set +e
  run_psql >"$RACE_DIR/run-first.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-run-first';
BEGIN;
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-before-retirement', 'silo-race', 'svc-race-run-first', 'rev-race-run-first', 'conversation-race-before-retirement', 'interactive',
  'request-race-before-retirement', 'run-race-before-retirement', 'sha256:' || repeat('c', 64),
  'sha256:' || repeat('d', 64)
);
INSERT INTO "run_input_snapshots" (
  "id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
  "effective_contract_digest", "conversation_id", "memory_facts", "identity_snapshot", "model_route",
  "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
) VALUES (
  'run-race-before-retirement-input', 'run-race-before-retirement', 1, 'silo-race', 'svc-race-run-first', 'rev-race-run-first',
  'sha256:' || repeat('c', 64), 'conversation-race-before-retirement', '[]', '{}', '{}', '[]', '{}', '{}',
  'sha256:' || repeat('e', 64), 'prompt-v1', 'sha256:' || repeat('d', 64)
);
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/run-first.status"
) &
run_first_pid=$!
wait_for_holder_sleeping 'phase-d-run-first'
(
  set +e
  run_psql >"$RACE_DIR/retire-after-run.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-retire-after-run';
UPDATE "agent_services"
SET "state" = 'retired', "active_revision_id" = NULL
WHERE "id" = 'svc-race-run-first';
SQL
  echo "$?" >"$RACE_DIR/retire-after-run.status"
) &
retire_after_run_pid=$!
wait_for_blocked_session 'phase-d-retire-after-run'
wait "$run_first_pid"
wait "$retire_after_run_pid"
if [[ "$(<"$RACE_DIR/run-first.status")" != "0" ]]; then
  cat "$RACE_DIR/run-first.out" >&2
  echo 'FAIL: AgentRun accepted before concurrent retirement failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/retire-after-run.status")" != "0" ]]; then
  cat "$RACE_DIR/retire-after-run.out" >&2
  echo 'FAIL: AgentService retirement did not serialize after run acceptance' >&2
  exit 1
fi
echo 'PASS: run acceptance commits before a serialized AgentService retirement'

run_psql <<'SQL'
INSERT INTO "verified_fleet_membership_revisions" (
  "id", "revision", "issuer_id", "issuer_key_id", "silo_id", "issued_at", "expires_at",
  "payload_digest", "signature", "verified_at"
) VALUES (
  'membership-race-accept-first', 1, 'fleet-race-accept-first', 'key-race', 'silo-race',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour',
  'sha256:' || repeat('4', 64), 'signature-race-1', clock_timestamp() - interval '30 seconds'
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/membership-accept.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-membership-acceptance';
BEGIN;
INSERT INTO "highest_accepted_fleet_memberships" (
  "issuer_id", "silo_id", "revision_id", "revision", "accepted_at"
) VALUES (
  'fleet-race-accept-first', 'silo-race', 'membership-race-accept-first', 1, clock_timestamp()
);
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/membership-accept.status"
) &
membership_accept_pid=$!
wait_for_holder_sleeping 'phase-d-membership-acceptance'
(
  set +e
  run_psql >"$RACE_DIR/membership-assert-late.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-membership-assert-late';
INSERT INTO "verified_fleet_membership_assertions" (
  "id", "revision_id", "assertion_id", "silo_id", "subject_id"
) VALUES (
  'assertion-race-late', 'membership-race-accept-first', 'assertion-race-late',
  'silo-race', 'user-race'
);
SQL
  echo "$?" >"$RACE_DIR/membership-assert-late.status"
) &
membership_assert_late_pid=$!
wait_for_blocked_session 'phase-d-membership-assert-late'
wait "$membership_accept_pid"
wait "$membership_assert_late_pid"
if [[ "$(<"$RACE_DIR/membership-accept.status")" != "0" ]]; then
  cat "$RACE_DIR/membership-accept.out" >&2
  echo 'FAIL: concurrent fleet membership acceptance failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/membership-assert-late.status")" == "0" ]] \
  || [[ "$(<"$RACE_DIR/membership-assert-late.out")" != *"accepted fleet membership assertions are sealed"* ]]; then
  cat "$RACE_DIR/membership-assert-late.out" >&2
  echo 'FAIL: assertion insertion bypassed concurrent fleet membership acceptance' >&2
  exit 1
fi
echo 'PASS: concurrent membership acceptance serializes and rejects a late assertion'

run_psql <<'SQL'
INSERT INTO "verified_fleet_membership_revisions" (
  "id", "revision", "issuer_id", "issuer_key_id", "silo_id", "issued_at", "expires_at",
  "payload_digest", "signature", "verified_at"
) VALUES (
  'membership-race-assert-first', 1, 'fleet-race-assert-first', 'key-race', 'silo-race',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour',
  'sha256:' || repeat('5', 64), 'signature-race-2', clock_timestamp() - interval '30 seconds'
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/membership-assert-first.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-membership-assert-first';
BEGIN;
INSERT INTO "verified_fleet_membership_assertions" (
  "id", "revision_id", "assertion_id", "silo_id", "subject_id"
) VALUES (
  'assertion-race-first', 'membership-race-assert-first', 'assertion-race-first',
  'silo-race', 'user-race'
);
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/membership-assert-first.status"
) &
membership_assert_first_pid=$!
wait_for_holder_sleeping 'phase-d-membership-assert-first'
(
  set +e
  run_psql >"$RACE_DIR/membership-accept-second.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-membership-accept-second';
INSERT INTO "highest_accepted_fleet_memberships" (
  "issuer_id", "silo_id", "revision_id", "revision", "accepted_at"
) VALUES (
  'fleet-race-assert-first', 'silo-race', 'membership-race-assert-first', 1, clock_timestamp()
);
SQL
  echo "$?" >"$RACE_DIR/membership-accept-second.status"
) &
membership_accept_second_pid=$!
wait_for_blocked_session 'phase-d-membership-accept-second'
wait "$membership_assert_first_pid"
wait "$membership_accept_second_pid"
if [[ "$(<"$RACE_DIR/membership-assert-first.status")" != "0" ]]; then
  cat "$RACE_DIR/membership-assert-first.out" >&2
  echo 'FAIL: pre-acceptance membership assertion failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/membership-accept-second.status")" != "0" ]]; then
  cat "$RACE_DIR/membership-accept-second.out" >&2
  echo 'FAIL: fleet membership acceptance did not serialize after the assertion' >&2
  exit 1
fi
echo 'PASS: pre-acceptance assertion commits before the serialized membership seal'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name",
  "workload_profile", "principal_id", "updated_at"
) VALUES (
  'svc-race-cancel-proof', 'silo-race-cancel-proof', 'managed', 'Cancellation proof race',
  'standard', 'svc-race-cancel-proof-principal', clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_definition_id", "budget", "authored_by"
) VALUES (
  'rev-race-cancel-proof', 'silo-race-cancel-proof', 'svc-race-cancel-proof', 1, 'draft', 'sha256:' || repeat('9', 64),
  'prompt-v1', 'phase-d-cancel-proof-model', '{}', 'user-race-cancel-proof'
);
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'rev-race-cancel-proof';
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-cancel-proof'
WHERE "id" = 'svc-race-cancel-proof';
BEGIN;
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-cancel-proof', 'silo-race-cancel-proof', 'svc-race-cancel-proof',
  'rev-race-cancel-proof', 'interactive', 'request-race-cancel-proof', 'run-race-cancel-proof',
  'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64)
);
INSERT INTO "run_input_snapshots" (
  "id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
  "effective_contract_digest", "conversation_id", "memory_facts", "identity_snapshot", "model_route",
  "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
) VALUES (
  'run-race-cancel-proof-input', 'run-race-cancel-proof', 1, 'silo-race-cancel-proof',
  'svc-race-cancel-proof', 'rev-race-cancel-proof', 'sha256:' || repeat('a', 64), NULL,
  '[]', '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1',
  'sha256:' || repeat('b', 64)
);
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-race-cancel-proof';
INSERT INTO "workload_assignments" (
  "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
  "workload_profile", "pod_uid", "expires_at"
) VALUES (
  'run-race-cancel-proof', 1, 'svc-race-cancel-proof', 'rev-race-cancel-proof',
  'silo-race-cancel-proof', 'agent-service:svc-race-cancel-proof',
  'opencrane-managed-agent-runtime', 'runtime', 'managed-race-cancel-proof', 'deployment',
  'pod-race-cancel-proof', 'standard', 'pod-race-cancel-proof',
  clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-race-cancel-proof';
INSERT INTO "warm_runtime_reservations" (
  "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
  "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
  "service_account_name", "state", "idle_deadline"
) VALUES (
  'run-race-cancel-proof', 1, 1, 'silo-race-cancel-proof', 'managed-race-cancel-proof',
  'phase-d-managed-warm', 'deployment-race-cancel-proof', 'pod-race-cancel-proof',
  'pod-race-cancel-proof', '1', 'generic', 'standard', 'runtime', 'reserved',
  clock_timestamp() + interval '30 minutes'
);
INSERT INTO "workload_bootstraps" (
  "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
  "claim_digest", "expires_at"
) VALUES (
  'bootstrap-race-cancel-proof', 'run-race-cancel-proof', 1, 'svc-race-cancel-proof',
  'rev-race-cancel-proof', 'silo-race-cancel-proof', 'agent-service:svc-race-cancel-proof',
  'opencrane-managed-agent-runtime', 'runtime', 'managed-race-cancel-proof', 'deployment',
  'pod-race-cancel-proof', 'sha256:' || repeat('c', 64), clock_timestamp() + interval '30 minutes'
);
UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-race-cancel-proof', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-race-cancel-proof' AND "attempt" = 1;
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-race-cancel-proof',
    "receipt_id" = 'receipt-race-cancel-proof'
WHERE "id" = 'bootstrap-race-cancel-proof';
COMMIT;
SQL

(
  set +e
  run_psql >"$RACE_DIR/cancellation-proof-fence.out" 2>&1 <<'SQL'
SET application_name = 'phase-e-cancellation-proof-fence';
BEGIN;
UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-race-cancel-proof';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/cancellation-proof-fence.status"
) &
cancellation_proof_fence_pid=$!
wait_for_holder_sleeping 'phase-e-cancellation-proof-fence'
(
  set +e
  run_psql >"$RACE_DIR/cancellation-proof-mint.out" 2>&1 <<'SQL'
SET application_name = 'phase-e-cancellation-proof-mint';
INSERT INTO "run_proof_keys" (
  "id", "bootstrap_id", "run_id", "attempt", "workload_kind", "workload_uid", "pod_uid",
  "public_key_jwk", "key_thumbprint", "expires_at"
) VALUES (
  'proof-race-cancel-proof', 'bootstrap-race-cancel-proof', 'run-race-cancel-proof', 1,
  'deployment', 'pod-race-cancel-proof', 'pod-race-cancel-proof', '{}', repeat('q', 43),
  clock_timestamp() + interval '20 minutes'
);
SQL
  echo "$?" >"$RACE_DIR/cancellation-proof-mint.status"
) &
cancellation_proof_mint_pid=$!
wait_for_blocked_session 'phase-e-cancellation-proof-mint'
wait "$cancellation_proof_fence_pid"
wait "$cancellation_proof_mint_pid"
if [[ "$(<"$RACE_DIR/cancellation-proof-fence.status")" != "0" ]]; then
  cat "$RACE_DIR/cancellation-proof-fence.out" >&2
  echo 'FAIL: cancellation proof fence did not commit' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/cancellation-proof-mint.status")" == "0" ]] \
  || ! grep -q 'RunProofKey requires the current Assigned attempt' "$RACE_DIR/cancellation-proof-mint.out"; then
  cat "$RACE_DIR/cancellation-proof-mint.out" >&2
  echo 'FAIL: proof mint bypassed the concurrent cancellation fence' >&2
  exit 1
fi
echo 'PASS: proof mint waits for run authority and rejects after cancellation begins'

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name", "workload_profile", "updated_at"
) VALUES (
  'phase-d-attempt-proof-service', 'phase-d-attempt-proof-silo', 'personal',
  'Attempt-history proof service', 'personal-default', clock_timestamp()
);
INSERT INTO "conversations" (
  "id", "silo_id", "mode", "agent_service_id", "updated_at"
) VALUES (
  'phase-d-child-attempt-conversation', 'phase-d-attempt-proof-silo', 'agent_session',
  'phase-d-attempt-proof-service', clock_timestamp()
);
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
  "request_idempotency_key", "root_run_id", "parent_run_id", "attempt", "state",
  "effective_contract_digest", "input_snapshot_digest", "started_at", "finished_at", "terminal_reason"
) VALUES
  (
    'phase-d-child-attempt-parent', 'phase-d-attempt-proof-silo', 'phase-d-attempt-proof-service',
    'phase-d-attempt-proof-revision',
    'phase-d-child-attempt-conversation', 'interactive', 'phase-d-child-attempt-parent-request',
    'phase-d-child-attempt-parent', NULL, 1, 'running', 'sha256:' || repeat('1', 64),
    'sha256:' || repeat('2', 64), clock_timestamp(), NULL, NULL
  ),
  (
    'phase-d-child-attempt-child', 'phase-d-attempt-proof-silo', 'phase-d-attempt-proof-service',
    'phase-d-attempt-proof-revision', NULL, 'managed_invocation',
    'phase-d-child-attempt-child-request', 'phase-d-child-attempt-parent',
    'phase-d-child-attempt-parent', 1, 'failed', 'sha256:' || repeat('3', 64),
    'sha256:' || repeat('4', 64), clock_timestamp(), clock_timestamp(), 'runtime_failure'
  );
INSERT INTO "child_run_reservations" (
  "child_run_id", "parent_run_id", "root_run_id", "depth", "max_tokens", "max_cost_usd_micros"
) VALUES (
  'phase-d-child-attempt-child', 'phase-d-child-attempt-parent',
  'phase-d-child-attempt-parent', 1, 1000, 1000000
);
SET LOCAL session_replication_role = origin;
INSERT INTO "child_run_completion_deliveries" (
  "child_run_id", "child_attempt", "parent_run_id", "parent_attempt", "parent_event_sequence", "outcome"
) VALUES (
  'phase-d-child-attempt-child', 1, 'phase-d-child-attempt-parent', 1, 1, 'delivered'
);
INSERT INTO "conversation_run_events" (
  "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
  'phase-d-child-attempt-conversation', 'phase-d-child-attempt-parent', 1, 1,
  'child.run.failed', '{"childRunId":"phase-d-child-attempt-child","childAttempt":1}'
);
COMMIT;
SQL

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE "agent_runs"
SET "attempt" = 2, "state" = 'completed', "accepted_at" = "accepted_at" + interval '1 second',
    "started_at" = clock_timestamp(), "finished_at" = clock_timestamp(), "terminal_reason" = 'success'
WHERE "id" = 'phase-d-child-attempt-child';
SET LOCAL session_replication_role = origin;
INSERT INTO "child_run_completion_deliveries" (
  "child_run_id", "child_attempt", "parent_run_id", "parent_attempt", "parent_event_sequence", "outcome"
) VALUES (
  'phase-d-child-attempt-child', 2, 'phase-d-child-attempt-parent', 1, 2, 'delivered'
);
INSERT INTO "conversation_run_events" (
  "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
  'phase-d-child-attempt-conversation', 'phase-d-child-attempt-parent', 1, 2,
  'child.run.completed', '{"childRunId":"phase-d-child-attempt-child","childAttempt":2}'
);
COMMIT;
SQL

run_psql <<'SQL'
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "child_run_completion_deliveries"
    WHERE "child_run_id" = 'phase-d-child-attempt-child' AND "outcome" = 'delivered'
  ) <> 2 THEN
    RAISE EXCEPTION 'FAIL: child retry did not preserve both delivered attempt receipts';
  END IF;
  IF (
    SELECT count(*)
    FROM "child_run_completion_deliveries" delivery
    JOIN "conversation_run_events" event
      ON event."run_id" = delivery."parent_run_id"
     AND event."attempt" = delivery."parent_attempt"
     AND event."sequence" = delivery."parent_event_sequence"
     AND event."payload"->>'childRunId' = delivery."child_run_id"
     AND event."payload"->>'childAttempt' = delivery."child_attempt"::text
     AND event."type" = CASE delivery."child_attempt"
       WHEN 1 THEN 'child.run.failed'
       WHEN 2 THEN 'child.run.completed'
     END
    WHERE delivery."child_run_id" = 'phase-d-child-attempt-child'
      AND delivery."outcome" = 'delivered'
  ) <> 2 THEN
    RAISE EXCEPTION 'FAIL: child retry receipts do not bind both parent attempt events';
  END IF;
  RAISE NOTICE 'PASS: later child attempts commit distinct deliveries and matching parent events';
END;
$$;
SQL

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO "conversations" (
  "id", "silo_id", "mode", "agent_service_id", "updated_at"
) VALUES (
  'phase-d-parent-attempt-conversation', 'phase-d-attempt-proof-silo', 'agent_session',
  'phase-d-attempt-proof-service', clock_timestamp()
);
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
  "request_idempotency_key", "root_run_id", "parent_run_id", "attempt", "state",
  "effective_contract_digest", "input_snapshot_digest", "started_at", "finished_at", "terminal_reason"
) VALUES
  (
    'phase-d-parent-attempt-parent', 'phase-d-attempt-proof-silo', 'phase-d-attempt-proof-service',
    'phase-d-attempt-proof-revision',
    'phase-d-parent-attempt-conversation', 'interactive', 'phase-d-parent-attempt-parent-request',
    'phase-d-parent-attempt-parent', NULL, 1, 'failed', 'sha256:' || repeat('5', 64),
    'sha256:' || repeat('6', 64), clock_timestamp(), clock_timestamp(), 'runtime_failure'
  ),
  (
    'phase-d-parent-attempt-child', 'phase-d-attempt-proof-silo', 'phase-d-attempt-proof-service',
    'phase-d-attempt-proof-revision', NULL, 'managed_invocation',
    'phase-d-parent-attempt-child-request', 'phase-d-parent-attempt-parent',
    'phase-d-parent-attempt-parent', 1, 'completed', 'sha256:' || repeat('7', 64),
    'sha256:' || repeat('8', 64), clock_timestamp(), clock_timestamp(), 'success'
  );
INSERT INTO "child_run_reservations" (
  "child_run_id", "parent_run_id", "root_run_id", "depth", "max_tokens", "max_cost_usd_micros"
) VALUES (
  'phase-d-parent-attempt-child', 'phase-d-parent-attempt-parent',
  'phase-d-parent-attempt-parent', 1, 1000, 1000000
);
SET LOCAL session_replication_role = origin;
INSERT INTO "conversation_run_events" (
  "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
  'phase-d-parent-attempt-conversation', 'phase-d-parent-attempt-parent', 1, 1,
  'run.failed', '{}'
);
INSERT INTO "child_run_completion_deliveries" (
  "child_run_id", "child_attempt", "parent_run_id", "parent_attempt", "parent_event_sequence", "outcome"
) VALUES (
  'phase-d-parent-attempt-child', 1, 'phase-d-parent-attempt-parent', 1, NULL,
  'parent_stream_terminal'
);
COMMIT;
SQL

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE "agent_runs"
SET "attempt" = 2, "state" = 'running', "accepted_at" = "accepted_at" + interval '1 second',
    "started_at" = clock_timestamp(), "finished_at" = NULL, "terminal_reason" = NULL
WHERE "id" = 'phase-d-parent-attempt-parent';
SET LOCAL session_replication_role = origin;
INSERT INTO "child_run_completion_deliveries" (
  "child_run_id", "child_attempt", "parent_run_id", "parent_attempt", "parent_event_sequence", "outcome"
) VALUES (
  'phase-d-parent-attempt-child', 1, 'phase-d-parent-attempt-parent', 2, 2, 'delivered'
);
INSERT INTO "conversation_run_events" (
  "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
  'phase-d-parent-attempt-conversation', 'phase-d-parent-attempt-parent', 2, 2,
  'child.run.completed', '{"childRunId":"phase-d-parent-attempt-child","childAttempt":1}'
);
COMMIT;
SQL

run_psql <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "child_run_completion_deliveries"
    WHERE "child_run_id" = 'phase-d-parent-attempt-child' AND "child_attempt" = 1
      AND "parent_attempt" = 1 AND "parent_event_sequence" IS NULL
      AND "outcome" = 'parent_stream_terminal'
  ) OR NOT EXISTS (
    SELECT 1
    FROM "child_run_completion_deliveries"
    WHERE "child_run_id" = 'phase-d-parent-attempt-child' AND "child_attempt" = 1
      AND "parent_attempt" = 2 AND "parent_event_sequence" = 2 AND "outcome" = 'delivered'
  ) THEN
    RAISE EXCEPTION 'FAIL: parent retry did not preserve suppression and later delivery';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "conversation_run_events"
    WHERE "run_id" = 'phase-d-parent-attempt-parent' AND "attempt" = 1
      AND "sequence" = 1 AND "type" = 'run.failed'
  ) OR NOT EXISTS (
    SELECT 1
    FROM "conversation_run_events"
    WHERE "run_id" = 'phase-d-parent-attempt-parent' AND "attempt" = 2
      AND "sequence" = 2 AND "type" = 'child.run.completed'
      AND "payload"->>'childRunId' = 'phase-d-parent-attempt-child'
      AND "payload"->>'childAttempt' = '1'
  ) THEN
    RAISE EXCEPTION 'FAIL: parent retry events do not bind their distinct attempts';
  END IF;
  RAISE NOTICE 'PASS: terminal suppression is scoped to one parent attempt and a retry can deliver';
END;
$$;
SQL

run_psql <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE "agent_runs"
SET "attempt" = 2, "state" = 'running', "accepted_at" = "accepted_at" + interval '1 second',
    "started_at" = clock_timestamp(), "finished_at" = NULL, "terminal_reason" = NULL
WHERE "id" = 'phase-d-child-attempt-parent';
SET LOCAL session_replication_role = origin;
COMMIT;
SQL

(
  set +e
  run_psql >"$RACE_DIR/child-delivery-duplicate.out" 2>&1 <<'SQL'
INSERT INTO "child_run_completion_deliveries" (
  "child_run_id", "child_attempt", "parent_run_id", "parent_attempt", "parent_event_sequence", "outcome"
) VALUES (
  'phase-d-child-attempt-child', 2, 'phase-d-child-attempt-parent', 2, 3, 'delivered'
);
SQL
  echo "$?" >"$RACE_DIR/child-delivery-duplicate.status"
)
if [[ "$(<"$RACE_DIR/child-delivery-duplicate.status")" == "0" ]] \
  || ! grep -q 'child_run_completion_deliveries_one_delivery_per_attempt' "$RACE_DIR/child-delivery-duplicate.out"; then
  cat "$RACE_DIR/child-delivery-duplicate.out" >&2
  echo 'FAIL: duplicate delivered child attempt bypassed partial uniqueness' >&2
  exit 1
fi
echo 'PASS: partial uniqueness rejects a duplicate delivered child attempt'
