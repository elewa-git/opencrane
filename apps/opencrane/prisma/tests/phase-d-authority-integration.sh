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

run_psql < "$TEST_FILE"
run_psql < "$SCRIPT_DIR/run-input-snapshot-admission.sql"
run_psql < "$SCRIPT_DIR/run-dispatch-terminalization.sql"

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
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "updated_at"
) VALUES (
  'dispatch-lock-service', 'dispatch-lock-silo', 'personal', 'Dispatch lock service',
  'user', 'dispatch-lock-user', 'personal-default', clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by"
) VALUES (
  'dispatch-lock-revision', 'dispatch-lock-service', 1, 'draft',
  'sha256:' || repeat('e', 64), 'prompt-v1', 'model-v1', '{}', 'dispatch-lock-user'
);
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'dispatch-lock-revision';
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'dispatch-lock-revision'
WHERE "id" = 'dispatch-lock-service';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('dispatch-lock-thread', 'dispatch-lock-silo', 'dispatch-lock-service', clock_timestamp());
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'dispatch-lock-run', 'dispatch-lock-silo', 'dispatch-lock-service', 'dispatch-lock-revision',
  'dispatch-lock-thread', 'interactive', 'dispatch-lock-request', 'dispatch-lock-run',
  'sha256:' || repeat('f', 64), 'sha256:' || repeat('0', 64)
);
INSERT INTO "run_outbox_events" (
  "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
  'dispatch-lock-outbox', 'dispatch-lock-run', 1, 1, 'run.attempt_requested',
  'dispatch-lock-run:attempt:1', '{"runId":"dispatch-lock-run","attempt":1}'
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/dispatch-event-holder.out" 2>&1 <<'SQL'
SET application_name = 'phase-e-dispatch-event-holder';
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('dispatch-lock-run', 0));
SELECT pg_sleep(3);
INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload", "occurred_at")
VALUES ('dispatch-lock-run', 1, 'run.started', '{}', clock_timestamp());
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/dispatch-event-holder.status"
) &
dispatch_event_holder_pid=$!
wait_for_holder_sleeping 'phase-e-dispatch-event-holder'
(
  set +e
  run_psql >"$RACE_DIR/dispatch-terminalizer.out" 2>&1 <<'SQL'
SET application_name = 'phase-e-dispatch-terminalizer';
BEGIN;
SELECT "id" FROM "agent_services" WHERE "id" = 'dispatch-lock-service' FOR UPDATE;
SELECT pg_advisory_xact_lock(hashtextextended('dispatch-lock-run', 0));
SELECT "id" FROM "agent_runs" WHERE "id" = 'dispatch-lock-run' FOR UPDATE;
SELECT "id" FROM "run_outbox_events" WHERE "id" = 'dispatch-lock-outbox' FOR UPDATE;
UPDATE "run_outbox_events"
SET "claimed_at" = clock_timestamp(), "delivery_count" = 1,
    "failed_at" = clock_timestamp(), "failure_code" = 'RUN_DISPATCH_SNAPSHOT_INVALID'
WHERE "id" = 'dispatch-lock-outbox';
UPDATE "agent_runs"
SET "state" = 'failed', "terminal_reason" = 'invalid_input', "finished_at" = clock_timestamp()
WHERE "id" = 'dispatch-lock-run';
INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload", "occurred_at")
VALUES (
  'dispatch-lock-run', 2, 'run.failed',
  '{"terminalReason":"invalid_input","failureCode":"RUN_DISPATCH_SNAPSHOT_INVALID"}',
  clock_timestamp()
);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/dispatch-terminalizer.status"
) &
dispatch_terminalizer_pid=$!
wait_for_blocked_session 'phase-e-dispatch-terminalizer'
wait "$dispatch_event_holder_pid"
wait "$dispatch_terminalizer_pid"
if [[ "$(<"$RACE_DIR/dispatch-event-holder.status")" != "0" ]]; then
  cat "$RACE_DIR/dispatch-event-holder.out" >&2
  echo 'FAIL: concurrent conversation event append failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/dispatch-terminalizer.status")" != "0" ]]; then
  cat "$RACE_DIR/dispatch-terminalizer.out" >&2
  echo 'FAIL: dispatch terminalisation deadlocked with a conversation event append' >&2
  exit 1
fi
echo 'PASS: dispatch terminalisation serializes behind concurrent conversation event append without deadlock'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-assignment', 'silo-race', 'managed', 'Assignment race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by"
) VALUES (
  'rev-race-assignment', 'svc-race-assignment', 1, 'draft', 'sha256:' || repeat('1', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race'
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-assignment-first', 'silo-race', 'managed', 'Assignment first race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by"
) VALUES (
  'rev-race-assignment-first', 'svc-race-assignment-first', 1, 'draft', 'sha256:' || repeat('6', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race'
);
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-activation', 'silo-race', 'managed', 'Activation race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-activation', 'svc-race-activation', 1, 'published', 'sha256:' || repeat('2', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp()
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-retirement', 'silo-race', 'managed', 'Retirement race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-retirement', 'svc-race-retirement', 1, 'published', 'sha256:' || repeat('3', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp()
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-run-rollover', 'silo-race', 'managed', 'Run rollover race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by", "published_at"
) VALUES
  ('rev-race-run-rollover-1', 'svc-race-run-rollover', 1, 'published', 'sha256:' || repeat('7', 64),
   'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp()),
  ('rev-race-run-rollover-2', 'svc-race-run-rollover', 2, 'published', 'sha256:' || repeat('8', 64),
   'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp());
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-run-rollover-1'
WHERE "id" = 'svc-race-run-rollover';
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
  "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-superseded', 'silo-race', 'svc-race-run-rollover', 'rev-race-run-rollover-1', 'thread-race-superseded', 'interactive',
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "created_at", "updated_at"
) VALUES (
  'svc-race-run-first', 'silo-race', 'managed', 'Run first race', 'organization', 'org-race',
  'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-run-first', 'svc-race-run-first', 1, 'published', 'sha256:' || repeat('b', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp()
);
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-run-first'
WHERE "id" = 'svc-race-run-first';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('thread-race-before-retirement', 'silo-race', 'svc-race-run-first', clock_timestamp());
SQL

(
  set +e
  run_psql >"$RACE_DIR/run-first.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-run-first';
BEGIN;
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-before-retirement', 'silo-race', 'svc-race-run-first', 'rev-race-run-first', 'thread-race-before-retirement', 'interactive',
  'request-race-before-retirement', 'run-race-before-retirement', 'sha256:' || repeat('c', 64),
  'sha256:' || repeat('d', 64)
);
INSERT INTO "run_input_snapshots" (
  "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
  "effective_contract_digest", "thread_id", "memory_facts", "identity_snapshot", "model_route",
  "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
) VALUES (
  'run-race-before-retirement', 1, 'silo-race', 'svc-race-run-first', 'rev-race-run-first',
  'sha256:' || repeat('c', 64), 'thread-race-before-retirement', '[]', '{}', '{}', '{}', '{}',
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
  "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
) VALUES (
  'assertion-race-late', 'membership-race-accept-first', 'assertion-race-late',
  'silo-race', 'user-race', 'organization', 'org-race'
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
  || ! grep -q 'accepted fleet membership assertions are sealed' "$RACE_DIR/membership-assert-late.out"; then
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
  "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
) VALUES (
  'assertion-race-first', 'membership-race-assert-first', 'assertion-race-first',
  'silo-race', 'user-race', 'organization', 'org-race'
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
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id", "workload_profile",
  "created_at", "updated_at"
) VALUES (
  'svc-race-action-authority', 'silo-race-action', 'managed', 'Action authority race',
  'organization', 'org-race', 'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by", "published_at"
) VALUES (
  'rev-race-action-authority', 'svc-race-action-authority', 1, 'published',
  'sha256:' || repeat('e', 64), 'prompt-v1', 'model-v1', '{}', 'user-race', clock_timestamp()
);
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'rev-race-action-authority'
WHERE "id" = 'svc-race-action-authority';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('thread-race-action-authority', 'silo-race-action', 'svc-race-action-authority', clock_timestamp());
BEGIN;
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-action-authority', 'silo-race-action', 'svc-race-action-authority',
  'rev-race-action-authority', 'thread-race-action-authority', 'interactive', 'request-race-action-authority',
  'run-race-action-authority', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64)
);
INSERT INTO "run_input_snapshots" (
  "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
  "effective_contract_digest", "thread_id", "memory_facts", "identity_snapshot", "model_route",
  "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
) VALUES (
  'run-race-action-authority', 1, 'silo-race-action', 'svc-race-action-authority', 'rev-race-action-authority',
  'sha256:' || repeat('1', 64), 'thread-race-action-authority', '[]', '{}', '{}', '{}', '{}',
  'sha256:' || repeat('3', 64), 'prompt-v1', 'sha256:' || repeat('2', 64)
);
COMMIT;
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-race-action-authority';
INSERT INTO "workload_assignments" (
  "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES (
  'run-race-action-authority', 1, 'svc-race-action-authority', 'rev-race-action-authority',
  'silo-race-action', 'user-race', 'opencrane-agent-runtime', 'runtime', 'tenant-race-action', 'job',
  'job-race-action', 'personal-small', clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-race-action-authority';
INSERT INTO "workload_bootstraps" (
  "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
  "claim_digest", "expires_at"
) VALUES (
  'bootstrap-race-action', 'run-race-action-authority', 1, 'svc-race-action-authority',
  'rev-race-action-authority', 'silo-race-action', 'user-race', 'opencrane-agent-runtime', 'runtime',
  'tenant-race-action', 'job', 'job-race-action', 'sha256:' || repeat('3', 64),
  clock_timestamp() + interval '30 minutes'
);
UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-race-action', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-race-action-authority' AND "attempt" = 1;
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-race-action',
    "receipt_id" = 'bootstrap-receipt-race-action'
WHERE "id" = 'bootstrap-race-action';
INSERT INTO "run_proof_keys" (
  "id", "bootstrap_id", "run_id", "attempt", "workload_kind", "workload_uid", "pod_uid",
  "public_key_jwk", "key_thumbprint", "expires_at"
) VALUES (
  'proof-race-action', 'bootstrap-race-action', 'run-race-action-authority', 1, 'job',
  'job-race-action', 'pod-race-action', '{}', repeat('r', 43), clock_timestamp() + interval '20 minutes'
);
INSERT INTO "capability_catalog_revisions" (
  "id", "catalog_id", "revision", "digest", "capabilities", "created_by"
) VALUES (
  'catalog-revision-race-action', 'catalog-race-action', 1, 'sha256:' || repeat('4', 64), '{}', 'user-race'
);
UPDATE "agent_runs" SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-race-action-authority';
UPDATE "agent_runs" SET "state" = 'waiting_for_approval' WHERE "id" = 'run-race-action-authority';
INSERT INTO "approval_requests" (
  "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
  "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
  "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
  "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
  "resource_id", "action", "arguments_digest", "action_digest", "approver_policy_revision",
  "effective_policy_digest", "expires_at"
) VALUES (
  'approval-race-action', 'run-race-action-authority', 1, 'rev-race-action-authority',
  'svc-race-action-authority', 'silo-race-action', 'proof-race-action', repeat('r', 43),
  'user-race', 'opencrane-agent-runtime', 'runtime', 'tenant-race-action', 'job', 'job-race-action',
  'pod-race-action', 'catalog-race-action', 1, 'sha256:' || repeat('4', 64), 'email.send',
  'message', 'message-race', 'send', 'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64),
  'approver-v1', 'sha256:' || repeat('7', 64), clock_timestamp() + interval '1 hour'
);
SQL

(
  set +e
  run_psql >"$RACE_DIR/action-run-transition.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-action-run-transition';
BEGIN;
UPDATE "agent_runs" SET "state" = 'running' WHERE "id" = 'run-race-action-authority';
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/action-run-transition.status"
) &
action_run_transition_pid=$!
wait_for_holder_sleeping 'phase-d-action-run-transition'
(
  set +e
  run_psql >"$RACE_DIR/action-approval-decision.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-action-approval-decision';
UPDATE "approval_requests"
SET "state" = 'approved', "decided_by" = 'approver-race', "resume_token_hash" = 'resume-race-action'
WHERE "id" = 'approval-race-action';
SQL
  echo "$?" >"$RACE_DIR/action-approval-decision.status"
) &
action_approval_decision_pid=$!
wait_for_blocked_session 'phase-d-action-approval-decision'
wait "$action_run_transition_pid"
wait "$action_approval_decision_pid"
if [[ "$(<"$RACE_DIR/action-run-transition.status")" != "0" ]] \
  || [[ "$(<"$RACE_DIR/action-approval-decision.status")" != "0" ]]; then
  cat "$RACE_DIR/action-run-transition.out" "$RACE_DIR/action-approval-decision.out" >&2
  echo 'FAIL: approval/run-state race did not complete cleanly' >&2
  exit 1
fi
approval_race_state="$(run_psql --tuples-only --no-align --command='SELECT "state" FROM "approval_requests" WHERE "id" = '\''approval-race-action'\'';')"
if [[ "$approval_race_state" != "cancelled" ]]; then
  echo "FAIL: stale concurrent approval decision ended $approval_race_state instead of cancelled" >&2
  exit 1
fi
echo 'PASS: approval decision waits for run authority and cancels after the run leaves WaitingForApproval'

(
  set +e
  run_psql >"$RACE_DIR/action-assignment-revoke.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-action-assignment-revoke';
BEGIN;
UPDATE "workload_assignments"
SET "state" = 'revoked', "revoked_at" = clock_timestamp()
WHERE "run_id" = 'run-race-action-authority' AND "attempt" = 1;
SELECT pg_sleep(3);
COMMIT;
SQL
  echo "$?" >"$RACE_DIR/action-assignment-revoke.status"
) &
action_assignment_revoke_pid=$!
wait_for_holder_sleeping 'phase-d-action-assignment-revoke'
(
  set +e
  run_psql >"$RACE_DIR/action-receipt-reserve.out" 2>&1 <<'SQL'
SET application_name = 'phase-d-action-receipt-reserve';
INSERT INTO "action_execution_receipts" (
  "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
  "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
  "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
  "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
  "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint"
) VALUES (
  'receipt-race-action', 'silo-race-action', 'user-race', 'service:email-send', 'runtime',
  'tenant-race-action', 'job', 'job-race-action', 'pod-race-action', 'run-race-action-authority',
  1, 'svc-race-action-authority', 'rev-race-action-authority', 'proof-race-action', repeat('r', 43),
  'catalog-race-action', 1, 'sha256:' || repeat('4', 64), 'email.send', 'sha256:' || repeat('7', 64),
  'message', 'message-race', 'send', 'sha256:' || repeat('5', 64), 'jti-race-action', 'one_shot',
  'sha256:' || repeat('8', 64)
);
SQL
  echo "$?" >"$RACE_DIR/action-receipt-reserve.status"
) &
action_receipt_reserve_pid=$!
wait_for_blocked_session 'phase-d-action-receipt-reserve'
wait "$action_assignment_revoke_pid"
wait "$action_receipt_reserve_pid"
if [[ "$(<"$RACE_DIR/action-assignment-revoke.status")" != "0" ]]; then
  cat "$RACE_DIR/action-assignment-revoke.out" >&2
  echo 'FAIL: concurrent assignment revocation failed' >&2
  exit 1
fi
if [[ "$(<"$RACE_DIR/action-receipt-reserve.status")" == "0" ]] \
  || ! grep -q 'requires a current Registered WorkloadAssignment' "$RACE_DIR/action-receipt-reserve.out"; then
  cat "$RACE_DIR/action-receipt-reserve.out" >&2
  echo 'FAIL: receipt reservation bypassed concurrent assignment revocation' >&2
  exit 1
fi
echo 'PASS: receipt reservation waits for assignment authority and rejects after revocation'

run_psql <<'SQL'
INSERT INTO "agent_services" (
  "id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id",
  "workload_profile", "updated_at"
) VALUES (
  'svc-race-cancel-proof', 'silo-race-cancel-proof', 'personal', 'Cancellation proof race',
  'user', 'user-race-cancel-proof', 'personal-default', clock_timestamp()
);
INSERT INTO "agent_revisions" (
  "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
  "model_policy_id", "budget", "authored_by"
) VALUES (
  'rev-race-cancel-proof', 'svc-race-cancel-proof', 1, 'draft', 'sha256:' || repeat('9', 64),
  'prompt-v1', 'model-v1', '{}', 'user-race-cancel-proof'
);
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'rev-race-cancel-proof';
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'rev-race-cancel-proof'
WHERE "id" = 'svc-race-cancel-proof';
INSERT INTO "agent_runs" (
  "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
  "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
  'run-race-cancel-proof', 'silo-race-cancel-proof', 'svc-race-cancel-proof',
  'rev-race-cancel-proof', 'interactive', 'request-race-cancel-proof', 'run-race-cancel-proof',
  'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64)
);
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-race-cancel-proof';
INSERT INTO "workload_assignments" (
  "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
  "workload_profile", "expires_at"
) VALUES (
  'run-race-cancel-proof', 1, 'svc-race-cancel-proof', 'rev-race-cancel-proof',
  'silo-race-cancel-proof', 'user-race-cancel-proof', 'opencrane-agent-runtime', 'runtime',
  'tenant-race-cancel-proof', 'job', 'job-race-cancel-proof', 'personal-default',
  clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-race-cancel-proof';
INSERT INTO "workload_bootstraps" (
  "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
  "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
  "claim_digest", "expires_at"
) VALUES (
  'bootstrap-race-cancel-proof', 'run-race-cancel-proof', 1, 'svc-race-cancel-proof',
  'rev-race-cancel-proof', 'silo-race-cancel-proof', 'user-race-cancel-proof',
  'opencrane-agent-runtime', 'runtime', 'tenant-race-cancel-proof', 'job',
  'job-race-cancel-proof', 'sha256:' || repeat('c', 64), clock_timestamp() + interval '30 minutes'
);
UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-race-cancel-proof', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-race-cancel-proof' AND "attempt" = 1;
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-race-cancel-proof',
    "receipt_id" = 'receipt-race-cancel-proof'
WHERE "id" = 'bootstrap-race-cancel-proof';
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
  'job', 'job-race-cancel-proof', 'pod-race-cancel-proof', '{}', repeat('q', 43),
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
